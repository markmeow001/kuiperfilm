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
  toSignedUrlIfCos,
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
  collectCharacterRefs,
  collectSceneRefs,
  buildSeedancePrompt,
  wrapRawPromptWithAudioDirective,
  planReferenceBudget,
  type CharacterRef,
  type SceneRef,
  type PanelLite,
} from './multi-shot-video-seedance-path'
import { extractSpokenLineFromSrtSegment } from './multi-shot-video-b-path'
import { buildDialogueDrivenDurations } from './speech-duration-estimator'
import { getMultiShotDurationWindow } from './multi-shot-duration-window'

// Phase 1.5C — resolve ARK's own window directly (was previously pulled
// via the seedance-path re-export under the 'taijiai' key, which obscured
// the provider identity). Both map to the same Seedance 2.0 4-15s window.
const { minTotalSec: MIN_DURATION_SEC, maxTotalSec: MAX_DURATION_SEC } =
  getMultiShotDurationWindow('ark')

/**
 * Resolve raw image URLs back to their active arkAssetId (if any).
 *
 * Walks the three subject tables (character_appearances, location_images,
 * novel_promotion_props) and pulls the rows where imageUrl matches +
 * arkAssetStatus='active' + arkAssetSourceUrl matches the current
 * imageUrl (stale assets where the user regenerated the image since
 * register are intentionally skipped — they'd point at the wrong art).
 *
 * Returns a Map<imageUrl, asset://<id>> the caller substitutes into the
 * ref list. Misses (no active asset for that URL) just stay absent — the
 * caller falls back to the raw URL.
 *
 * Performance: one OR'd findMany per table = 3 queries per video gen,
 * each indexed by no specific column (full scan of subjects in this
 * project). Cheap because subject counts are O(dozens) per project. If
 * this ever becomes a hot path, add an index on imageUrl or denormalize
 * arkAssetId into panels at register time.
 */
async function loadActiveArkAssetIdsByImageUrl(
  urls: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (urls.length === 0) return out
  const uniqueUrls = [...new Set(urls.filter((u) => u && !u.startsWith('asset://')))]
  if (uniqueUrls.length === 0) return out

  const [appearances, views, props] = await Promise.all([
    prisma.characterAppearance.findMany({
      where: {
        arkAssetStatus: 'active',
        arkAssetId: { not: null },
        imageUrl: { in: uniqueUrls },
      },
      select: { imageUrl: true, arkAssetId: true, arkAssetSourceUrl: true },
    }),
    prisma.locationImage.findMany({
      where: {
        arkAssetStatus: 'active',
        arkAssetId: { not: null },
        imageUrl: { in: uniqueUrls },
      },
      select: { imageUrl: true, arkAssetId: true, arkAssetSourceUrl: true },
    }),
    prisma.novelPromotionProp.findMany({
      where: {
        arkAssetStatus: 'active',
        arkAssetId: { not: null },
        imageUrl: { in: uniqueUrls },
      },
      select: { imageUrl: true, arkAssetId: true, arkAssetSourceUrl: true },
    }),
  ])

  // Only trust active assets whose registered sourceUrl still matches —
  // any drift means the user regenerated the underlying image and the
  // old asset still points at the prior art. Caller fall-through to raw
  // URL then surfaces InputImageSensitiveContentDetected if applicable,
  // prompting the user to re-register.
  for (const row of [...appearances, ...views, ...props]) {
    if (!row.imageUrl || !row.arkAssetId) continue
    if (row.arkAssetSourceUrl && row.arkAssetSourceUrl !== row.imageUrl) continue
    if (!out.has(row.imageUrl)) {
      out.set(row.imageUrl, `asset://${row.arkAssetId}`)
    }
  }

  return out
}

/**
 * Build the "图片N 用作 ..." prefix lines that tell Seedance which
 * registered asset corresponds to which character/scene by ordinal
 * position. Per CreateAsset docs § "三、注意事项" the prompt must
 * reference assets as 图片1 / 图片2, NOT by raw Asset ID — the asset_id
 * lives in content[].image_url.url only.
 *
 * Image numbering convention (matches ARK content[] assembly order in
 * generators/ark.ts):
 *   - first_frame (if present) → 图片1
 *   - reference_images[0..n] → 图片2..N+1 (or 图片1..N if no first_frame)
 *
 * Returns one line per image slot that we know maps to a named subject.
 * Unmapped slots are skipped silently (their image still goes through
 * content[] — Seedance just doesn't get a hint about what they are).
 */
function buildArkAssetMappingLines(args: {
  firstFrameUrl: string | undefined
  referenceUrls: string[]
  urlToAssetId: Map<string, string>
  characterRefs: CharacterRef[]
  sceneRefs: SceneRef[]
}): string[] {
  const { firstFrameUrl, referenceUrls, urlToAssetId, characterRefs, sceneRefs } = args
  const lines: string[] = []

  // Build a reverse lookup: imageUrl → display label (character or scene).
  const labelByUrl = new Map<string, string>()
  for (const c of characterRefs) {
    if (c.imageUrl && !labelByUrl.has(c.imageUrl)) {
      labelByUrl.set(c.imageUrl, `角色「${c.name}」`)
    }
  }
  for (const s of sceneRefs) {
    if (s.imageUrl && !labelByUrl.has(s.imageUrl)) {
      labelByUrl.set(s.imageUrl, `场景「${s.name}」`)
    }
  }

  const orderedUrls = firstFrameUrl ? [firstFrameUrl, ...referenceUrls] : referenceUrls
  for (let i = 0; i < orderedUrls.length; i += 1) {
    const url = orderedUrls[i]!
    const label = labelByUrl.get(url)
    if (!label) continue
    const isRegistered = urlToAssetId.has(url)
    const tag = isRegistered ? '（已报备素材）' : ''
    lines.push(`图片${i + 1} 是${label}${tag}`)
  }

  return lines
}

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
  /**
   * 2026-05-22 — output resolution. Threaded from project.videoResolution
   * via the dispatcher; user picks per project in V2 settings. When
   * omitted ARK Seedance 2.0 series defaults to 720p (per Volcengine
   * docs). Fast variant rejects 1080p — the generator's validator catches
   * that combination upfront before the API call.
   */
  resolution?: '480p' | '720p' | '1080p'
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
  // Phase S — per-group motion/camera reference video.
  let groupReferenceVideoUrl: string | null = null
  const firstStoryboardId = validPanels[0]?.storyboardId
  if (firstStoryboardId) {
    const sb = await prisma.novelPromotionStoryboard.findUnique({
      where: { id: firstStoryboardId },
      select: { episodeId: true, referenceVideoUrl: true },
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
    if (sb?.referenceVideoUrl) {
      groupReferenceVideoUrl = toSignedUrlIfCos(sb.referenceVideoUrl, 3600)
    }
  }
  for (const [charId, appearanceId] of charOverrideById) {
    episodeBindings.set(charId, appearanceId)
  }

  const projectData = await resolveNovelData(projectId)
  const usedPanels = validPanels.slice(0, MAX_REFERENCE_IMAGES)
  // Mine the hand-edited rawPrompt for character names too, so a name
  // written only in the narrative still resolves to a reference asset
  // (parity with the AtlasCloud path, 2026-05-28).
  const characterRefs = collectCharacterRefs(
    usedPanels,
    projectData,
    episodeBindings,
    params.rawPrompt,
  )
  const sceneRefs = collectSceneRefs(usedPanels, projectData, locOverrideById)

  const { firstFrameUrl, referenceUrls } = planReferenceBudget({
    panels: usedPanels,
    characterRefs,
    sceneRefs,
  })

  if (!firstFrameUrl && referenceUrls.length === 0) {
    throw new Error('ARK_COMPOSITE_NO_REFERENCES')
  }

  // ─────────────── Phase 3 (2026-05-23): asset:// substitution ───────
  // For each ref URL, look up whether the source subject (appearance /
  // location image / prop) has an ACTIVE arkAssetId pointing at this
  // exact imageUrl. If yes, swap the URL for `asset://<id>` so Seedance
  // 2.0 accepts the ref (otherwise the face filter rejects photoreal
  // AI portraits — see project_kuiperfilm_ark_seedance_2_face_policy
  // memory). Stale registrations (imageUrl regenerated since register)
  // fail the sourceUrl match and fall back to the raw URL — caller
  // surfaces the SensitiveContentDetected error from there.
  const allRefUrls = firstFrameUrl ? [firstFrameUrl, ...referenceUrls] : referenceUrls
  const urlToAssetId = await loadActiveArkAssetIdsByImageUrl(allRefUrls)
  const resolveRef = (url: string): string => urlToAssetId.get(url) ?? url
  const firstFrameRef = firstFrameUrl ? resolveRef(firstFrameUrl) : undefined
  const referenceRefs = referenceUrls.map(resolveRef)
  const assetIdHits = [...allRefUrls].filter((u) => urlToAssetId.has(u)).length

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

  // Duration priority mirrors seedance-path (incl. 2026-06-13 dialogue-driven
  // default: dialogue is the primary duration signal; silent groups fall back
  // to the panel-count baseline).
  let duration: number
  let durationSource: 'panelDurations' | 'totalDurationSeconds' | 'dialogueDriven' | 'baseline'
  if (params.panelDurations && params.panelDurations.length > 0) {
    const sum = params.panelDurations.reduce((s, d) => s + (Number.isFinite(d) ? d : 0), 0)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(sum)))
    durationSource = 'panelDurations'
  } else if (typeof params.totalDurationSeconds === 'number' && params.totalDurationSeconds > 0) {
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(params.totalDurationSeconds)))
    durationSource = 'totalDurationSeconds'
  } else {
    const dialogueByPanel = new Map<string, Array<{ speaker: string; content: string }>>()
    for (const panel of usedPanels) {
      const seg = (panel.srtSegment ?? '').trim()
      if (!seg) continue
      const extracted = extractSpokenLineFromSrtSegment(seg, '旁白')
      if (extracted) dialogueByPanel.set(panel.id, [extracted])
    }
    let driven: ReturnType<typeof buildDialogueDrivenDurations> = null
    try {
      driven = buildDialogueDrivenDurations({ panels: usedPanels, dialogueByPanelId: dialogueByPanel })
    } catch (err) {
      logger.warn({
        message: 'buildDialogueDrivenDurations failed, falling back to baseline',
        details: { error: (err as Error)?.message ?? '' },
      })
    }
    if (driven && driven.hasDialogue) {
      duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, driven.totalDuration))
      durationSource = 'dialogueDriven'
    } else {
      const baseline = Math.round(usedPanels.length * 2)
      duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, baseline))
      durationSource = 'baseline'
    }
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
      durationSource,
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

  // Phase 3 (2026-05-23) — asset:// mapping line. Per Volcengine
  // CreateAsset docs § "三、注意事项":
  //   "生成视频时,提示词中需使用「图片1/视频1」等格式指代素材,
  //    不要直接填写 Asset ID"
  // So the asset:// strings go into content[] (handled by the generator),
  // and the prompt itself only references them by 「图片1」 / 「图片2」
  // / etc. We build a small mapping line that prefixes the prompt with
  // "图片N 用作 <role-of-subject>" pointing at what each slot binds to.
  // Order is: first_frame is image 1 (if present), then reference_images
  // in the order planReferenceBudget assembled them (characters first,
  // then scenes, then leftover panel images).
  const assetMappingLines = buildArkAssetMappingLines({
    firstFrameUrl,
    referenceUrls,
    urlToAssetId,
    characterRefs,
    sceneRefs,
  })
  const assetMappingPrefix = assetMappingLines.length > 0
    ? `素材引用说明（请勿在台词或画面文字中重复以下编号）：\n${assetMappingLines.join('\n')}`
    : ''

  const stylizedPrompt = [assetMappingPrefix, stylePrefix, prompt, styleSuffix, arkNegativeSuffix]
    .filter((s) => s.length > 0)
    .join('\n\n')

  const generator = new ArkSeedanceVideoGenerator()
  const generateResult = await generator.generate({
    userId,
    // Same '' convention as BobAPI path — ArkVideoGenerator treats empty
    // imageUrl as "pure t2v with reference_image content items". Phase 3:
    // pass firstFrameRef (asset:// or URL) so ARK uses the registered
    // asset when available.
    imageUrl: firstFrameRef ?? '',
    prompt: stylizedPrompt,
    options: {
      modelId: arkModelId,
      duration,
      aspectRatio,
      generateAudio: sound,
      // Phase 3: referenceRefs already has asset:// substituted in for
      // every URL that maps to an active arkAssetId. Mixed mode (some
      // URLs, some asset://) is supported — ARK happily fetches URLs
      // for unregistered refs and looks up asset:// inline.
      referenceImages: referenceRefs,
      // 2026-05-22 — user-selected resolution. Omitted (undefined) means
      // ARK falls back to its model default (720p for 2.0 series).
      // Fast variant rejects 1080p — caught upstream by ark.ts validator
      // (modelSpec.resolutionOptions check), not silently swallowed.
      ...(params.resolution ? { resolution: params.resolution } : {}),
      // Phase S — ARK Seedance 2.0 multi-modal `content[]` accepts a
      // single `referenceVideoUrl` (signed COS URL). Generator gates on
      // `modelSpec.supportsMultiModalReference` so non-2.0 models reject
      // it cleanly instead of silently dropping.
      ...(groupReferenceVideoUrl ? { referenceVideoUrl: groupReferenceVideoUrl } : {}),
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
