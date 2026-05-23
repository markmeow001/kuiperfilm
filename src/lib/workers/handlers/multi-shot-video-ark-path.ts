/**
 * ARK (火山方舟) Seedance 2.0 composite path for multi-shot video.
 *
 * Functional twin of multi-shot-video-seedance-path.ts (BobAPI / taijiai
 * route), running against the same Doubao Seedance 2.0 model but via the
 * Volcengine direct API at https://ark.cn-beijing.volces.com/api/v3.
 *
 * Why two paths instead of one shared:
 *   - Same model, same content[] multi-modal shape, same 4-15s window,
 *     same native dialogue+SFX support — so the prompt assembly +
 *     reference budget logic are IDENTICAL. Both imported from the
 *     seedance-path module so a future LLM-prompt tweak lands in one
 *     place.
 *   - Differences are in the wire layer:
 *       * ARK uses Bearer auth direct (no taijiai 302 redirect game).
 *       * ARK has no top-level `negative_prompt` field — the universal
 *         suppressor goes into a final positive-prompt line instead.
 *       * ARK content[] supports `video_url` + `audio_url` roles too
 *         (multi-modal beyond images); this path uses only images for
 *         now (parity with existing BobAPI behavior), audio/video refs
 *         are a follow-up if a feature requests them.
 *       * The poll loop reads from arkQueryVideoTask via async-poll's
 *         ARK handler (already wired by the single-shot Seedance 1.x
 *         path), not BobAPI's vshare OSS bearer flow.
 *
 * Provider scope: only `ark::doubao-seedance-2-0-*` model IDs route here.
 * Older `doubao-seedance-1-*` IDs stay on the single-panel path because
 * they don't support multi-modal reference content[].
 *
 * Output mapping mirrors the BobAPI path: ONE video → stored as the
 * storyboard's `multiShotVideoUrl` + single-element `multiShotClipUrls`.
 *
 * Spec: https://www.volcengine.com/docs/82379/1520757
 */

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { ArkSeedanceVideoGenerator } from '@/lib/generators/ark'
import {
  assertTaskActive,
  uploadVideoSourceToCos,
  waitExternalResult,
} from '../utils'
import { reportTaskProgress } from '../shared'
import { buildMultiShotClipUpdate } from '@/lib/storyboard/multi-shot-clips'
import { createScopedLogger } from '@/lib/logging/core'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { resolveNovelData } from './image-task-handler-shared'
import {
  resolveProjectVisualStyle,
  buildVisualStylePrefix,
  buildVisualStyleSuffix,
  getStyleSafe,
} from '@/lib/style-library'
import {
  UNIVERSAL_SEEDANCE_NEGATIVE,
  MAX_REFERENCE_IMAGES,
  MIN_DURATION_SEC,
  MAX_DURATION_SEC,
  collectCharacterRefs,
  collectSceneRefs,
  buildSeedancePrompt,
  wrapRawPromptWithAudioDirective,
  planReferenceBudget,
  type PanelLite,
} from './multi-shot-video-seedance-path'

/**
 * True when this videoModel routes to ARK Seedance 2.0 composite.
 * Used by the dispatcher in multi-shot-video-handler.ts. Fails closed
 * for everything else.
 */
export function shouldUseArkComposite(videoModel: string): boolean {
  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed) return false
  if (parsed.provider !== 'ark') return false
  // Only Seedance 2.0 family supports multi-modal references (the
  // capability flag lives in ark.ts ARK_SEEDANCE_MODEL_SPECS).
  return /^doubao-seedance-2-0(-fast)?-\d+$/.test(parsed.modelId)
}

/** Pick the concrete Seedance 2.0 ARK model id from a `ark::*` model key.
 *  Returns the stripped model id (without the `ark::` prefix). Throws when
 *  the key isn't an ARK 2.0 model — should never happen if dispatcher
 *  gated correctly. */
function extractArkModelId(videoModel: string): string {
  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed || parsed.provider !== 'ark') {
    throw new Error(`ARK_COMPOSITE_INVALID_MODEL_KEY: ${videoModel}`)
  }
  return parsed.modelId
}

/**
 * Run the ARK Seedance 2.0 composite for a panel group. Mirrors the
 * BobAPI seedance-path behavior; the comments there carry the rationale
 * for each phase. Differences vs seedance-path are marked `// ARK:`.
 */
export async function runMultiShotArkComposite(params: {
  job: Job<TaskJobData>
  projectId: string
  validPanels: PanelLite[]
  videoModel: string
  sound: boolean | undefined
  aspectRatio: string | undefined
  characterOverrides?: Array<{ characterId: string; appearanceId?: string }>
  locationOverrides?: Array<{ locationId: string; viewName?: string }>
  rawPrompt?: string
  panelDurations?: number[]
  totalDurationSeconds?: number
  visualStyleId?: string
  lightingPresetId?: string
}): Promise<{
  storyboardId: string
  multiShotVideoUrl: string
  multiShotClipUrls: string[]
  chunkCount: number
  shotCount: number
  subjectCount: number
  path: 'ark-composite'
  mode: 'i2v+refs' | 't2v+refs'
  bindings: {
    characters: Array<{ id: string; name: string; imageUrl: string }>
    scenes: Array<{ id: string; name: string; imageUrl: string }>
  }
}> {
  const { job, projectId, validPanels } = params
  const sound = params.sound ?? true
  const aspectRatio = params.aspectRatio ?? '16:9'
  const { userId } = job.data
  const arkModelId = extractArkModelId(params.videoModel)
  const logger = createScopedLogger({
    module: 'worker.multi-shot-ark',
    action: 'multi_shot_ark_composite',
  })

  if (validPanels.length === 0) {
    throw new Error('ARK_COMPOSITE_NO_PANELS')
  }

  await reportTaskProgress(job, 12, { stage: 'ark_composite_collect_refs' })

  // Per-call override maps mirror b-path / seedance-path shape.
  const charOverrideById = new Map<string, string>()
  for (const o of params.characterOverrides ?? []) {
    if (o.characterId && o.appearanceId) charOverrideById.set(o.characterId, o.appearanceId)
  }
  const locOverrideById = new Map<string, string>()
  for (const o of params.locationOverrides ?? []) {
    if (o.locationId && o.viewName) locOverrideById.set(o.locationId, o.viewName)
  }

  // Episode-level appearance bindings (all panels in a group share an
  // episode via storyboard).
  const episodeBindings = new Map<string, string>()
  const firstStoryboardId = validPanels[0]?.storyboardId
  if (firstStoryboardId) {
    const sb = await prisma.novelPromotionStoryboard.findUnique({
      where: { id: firstStoryboardId },
      select: { episodeId: true },
    })
    if (sb?.episodeId) {
      const rows = await prisma.episodeCharacter.findMany({
        where: { episodeId: sb.episodeId, appearanceId: { not: null } },
        select: { characterId: true, appearanceId: true },
      })
      for (const row of rows) {
        if (row.appearanceId) episodeBindings.set(row.characterId, row.appearanceId)
      }
    }
  }
  for (const [charId, appearanceId] of charOverrideById) {
    episodeBindings.set(charId, appearanceId)
  }

  const projectData = await resolveNovelData(projectId)
  const usedPanels = validPanels.slice(0, MAX_REFERENCE_IMAGES)
  const characterRefs = collectCharacterRefs(usedPanels, projectData, episodeBindings)
  const sceneRefs = collectSceneRefs(usedPanels, projectData, locOverrideById)

  const { firstFrameUrl, referenceUrls } = planReferenceBudget({
    panels: usedPanels,
    characterRefs,
    sceneRefs,
  })

  if (!firstFrameUrl && referenceUrls.length === 0) {
    throw new Error('ARK_COMPOSITE_NO_REFERENCES')
  }

  // Prompt source priority — identical to seedance-path: rawPrompt > built.
  let prompt: string
  let dialogueBeatCount: number
  if (params.rawPrompt && params.rawPrompt.trim().length > 0) {
    const built = wrapRawPromptWithAudioDirective(params.rawPrompt.trim())
    prompt = built.prompt
    dialogueBeatCount = built.dialogueBeatCount
  } else {
    const built = buildSeedancePrompt(
      usedPanels,
      characterRefs,
      sceneRefs,
      Boolean(firstFrameUrl),
    )
    prompt = built.prompt
    dialogueBeatCount = built.dialogueBeatCount
  }

  // Duration priority mirrors seedance-path.
  let duration: number
  if (params.panelDurations && params.panelDurations.length > 0) {
    const sum = params.panelDurations.reduce((s, d) => s + (Number.isFinite(d) ? d : 0), 0)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(sum)))
  } else if (typeof params.totalDurationSeconds === 'number' && params.totalDurationSeconds > 0) {
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(params.totalDurationSeconds)))
  } else {
    const baseline = Math.round(usedPanels.length * 2)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, baseline))
  }

  logger.info({
    message: 'ARK composite submit',
    details: {
      storyboardId: validPanels[0].storyboardId,
      arkModelId,
      panelsRequested: validPanels.length,
      panelsUsed: usedPanels.length,
      characterRefs: characterRefs.length,
      sceneRefs: sceneRefs.length,
      hasFirstFrame: Boolean(firstFrameUrl),
      referenceUrlCount: referenceUrls.length,
      duration,
      aspectRatio,
      generateAudio: sound,
      dialogueBeatCount,
      promptLength: prompt.length,
      mode: firstFrameUrl ? 'i2v+refs' : 't2v+refs',
    },
  })

  await assertTaskActive(job, 'ark_composite_submit')
  await reportTaskProgress(job, 20, { stage: 'ark_composite_submit' })

  // Visual style resolution — same priority cascade as seedance-path.
  const resolvedStyle = params.visualStyleId
    ? (() => {
        const s = getStyleSafe(params.visualStyleId)
        return s ? { style: s, lighting: null } : null
      })()
    : await resolveProjectVisualStyle(prisma, projectId)

  const stylePrefix = buildVisualStylePrefix(resolvedStyle).trim()
  const styleSuffix = buildVisualStyleSuffix(resolvedStyle).trim()

  // ARK: no top-level negative_prompt field (per Volcengine 2026-05-22
  // docs). Inline the universal suppressor as a final positive-prompt
  // line — Seedance attends to "禁止" markers when they're explicit about
  // what NOT to render. Style-specific negativePrompt skipped here; rely
  // on stylePrefix shaping instead.
  const arkNegativeSuffix =
    `（请勿在画面中渲染：${UNIVERSAL_SEEDANCE_NEGATIVE}。保持画面干净，无任何屏幕信息。）`

  const stylizedPrompt = [stylePrefix, prompt, styleSuffix, arkNegativeSuffix]
    .filter((s) => s.length > 0)
    .join('\n\n')

  const generator = new ArkSeedanceVideoGenerator()
  const generateResult = await generator.generate({
    userId,
    // Same '' convention as BobAPI path — ArkVideoGenerator treats empty
    // imageUrl as "pure t2v with reference_image content items".
    imageUrl: firstFrameUrl ?? '',
    prompt: stylizedPrompt,
    options: {
      modelId: arkModelId,
      duration,
      aspectRatio,
      generateAudio: sound,
      referenceImages: referenceUrls,
    },
  })

  if (!generateResult.success || !generateResult.externalId) {
    throw new Error(
      `ARK_COMPOSITE_SUBMIT_FAILED: ${generateResult.error ?? 'unknown'}`,
    )
  }

  await reportTaskProgress(job, 40, { stage: 'ark_composite_poll' })

  // ARK direct typically completes in 2-6 min for 15s clips; keep the
  // 15-min timeout from the BobAPI path as headroom for queue spikes.
  const polled = await waitExternalResult(job, generateResult.externalId, userId, {
    timeoutMs: 15 * 60 * 1000,
    progressStart: 40,
    progressEnd: 90,
  })

  if (!polled.url) {
    throw new Error('ARK_COMPOSITE_NO_RESULT_URL')
  }

  await reportTaskProgress(job, 92, { stage: 'ark_composite_persist' })

  // ARK video_url is a signed TOS URL with X-Tos-Signature query params
  // (per the doc response sample). It's directly fetchable without
  // bearer headers, unlike BobAPI's vshare OSS chain — so pass
  // downloadHeaders=undefined.
  const targetId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(
    polled.url,
    `multi-shot-ark/${targetId}`,
    targetId,
    polled.downloadHeaders,
  )

  await prisma.novelPromotionStoryboard.update({
    where: { id: targetId },
    data: buildMultiShotClipUpdate([cosKey]),
  })

  await reportTaskProgress(job, 98, { stage: 'ark_composite_done' })

  logger.info({
    message: 'ARK composite persisted',
    details: {
      storyboardId: targetId,
      cosKey,
      panelsUsed: usedPanels.length,
      characterRefs: characterRefs.length,
      sceneRefs: sceneRefs.length,
    },
  })

  return {
    storyboardId: targetId,
    multiShotVideoUrl: cosKey,
    multiShotClipUrls: [cosKey],
    chunkCount: 1,
    shotCount: usedPanels.length,
    subjectCount: characterRefs.length + sceneRefs.length,
    path: 'ark-composite',
    mode: firstFrameUrl ? 'i2v+refs' : 't2v+refs',
    bindings: {
      characters: characterRefs.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      scenes: sceneRefs.map((s) => ({ id: s.id, name: s.name, imageUrl: s.imageUrl })),
    },
  }
}
