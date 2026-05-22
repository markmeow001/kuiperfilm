/**
 * fal Seedance 2.0 "composite" path for multi-shot video.
 *
 * Multi-shot is a MODEL capability — Seedance 2.0 parses prompt-encoded
 * shot breakdowns ("第一鏡：… 第二鏡：…") and produces one composite
 * mp4 internally. The three fal endpoints differ only in what gets
 * ANCHORED:
 *
 *   - bytedance/seedance-2.0/image-to-video      (i2v):
 *       single first_frame image, optional end frame.
 *   - bytedance/seedance-2.0/fast/image-to-video (fast i2v):
 *       same shape, fast tier.
 *   - bytedance/seedance-2.0/reference-to-video      (r2v):
 *       up to 9 image_urls[], 3 video_urls[], 3 audio_urls[].
 *   - bytedance/seedance-2.0/fast/reference-to-video (fast r2v):
 *       same shape, fast tier.
 *
 * Tag convention: fal expects **@Image1 / @Image2 / @Video1 / @Audio1**
 * markers in the prompt (UPPERCASE I, no space, 1-indexed) to bind
 * specific references to specific shots. This differs from
 * AtlasCloud's "image 1 = 角色「X」" plain-text mapping — fal's
 * underlying Bytedance model gateway specifically looks for the @TagN
 * syntax.
 *
 * Shared reference collection: uses multi-shot-ref-collection helpers
 * (collectCharacterRefs / collectSceneRefs / collectPropRefs) so all
 * 3 vendor paths (BobAPI, AtlasCloud, fal) anchor identity from the
 * same pool of project catalog images.
 *
 * Output: one composite mp4 stored as the storyboard's
 * `multiShotVideoUrl` + single-element `multiShotClipUrls`. Same
 * persistence shape as BobAPI / Kling / AtlasCloud paths.
 */

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { FalVideoGenerator } from '@/lib/generators/fal'
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
  collectCharacterRefs,
  collectSceneRefs,
  collectPropRefs,
  type CharacterRef,
  type SceneRef,
  type PropRef,
} from './multi-shot-ref-collection'
import {
  resolveProjectVisualStyle,
  buildVisualStylePrefix,
  buildVisualStyleSuffix,
  buildVisualStyleNegative,
  getStyleSafe,
} from '@/lib/style-library'
import { buildDialogueDrivenDurations } from './speech-duration-estimator'
import { extractSpokenLineFromSrtSegment } from './multi-shot-video-b-path'

// fal Seedance r2v has no negative_prompt field at the API level either
// (verified from fal.ai/models/bytedance/seedance-2.0/reference-to-video).
// Phase R-1 (2026-05-22) — switched from inline "AVOID: 字幕,..." to a
// POSITIVE clean-frame directive after user reported the AVOID list
// itself being rendered as on-screen text (pink-elephant failure mode:
// mentioning 字幕 primes the model to paint subtitles). Style-library
// negativePrompt still ships separately because those visual-style
// suppressors (animation/3D render/etc.) work as expected.
const UNIVERSAL_FAL_CLEAN_FRAME_DIRECTIVE =
  'Pure live-action cinematic frame; only the narrative subject and environment appear; no text overlays, no UI graphics, no watermarks, no platform logos, no captions of any kind. The frame simulates clean unposted raw camera footage.'

const MAX_REFERENCE_IMAGES = 9
const MIN_DURATION_SEC = 4
const MAX_DURATION_SEC = 15

interface PanelLite {
  id: string
  imageUrl: string | null
  description: string | null
  videoPrompt: string | null
  characters: string | null
  props: string | null
  location: string | null
  srtSegment: string | null
  storyboardId: string
}

/** True when this videoModel routes to fal composite (any of the 4
 *  Seedance 2.0 variants — i2v / r2v × std / fast). i2v-only variants
 *  are included because Seedance 2.0's prompt-encoded multi-shot works
 *  on i2v endpoints too (the model decodes "第一鏡 / 第二鏡" inside
 *  the prompt regardless of which endpoint accepted the request). */
export function shouldUseFalComposite(videoModel: string): boolean {
  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed) return false
  if (parsed.provider !== 'fal') return false
  // Match bytedance/seedance-2.0/{image-to-video,reference-to-video,
  // fast/image-to-video,fast/reference-to-video}
  return /^bytedance\/seedance-2\.0(?:\/fast)?\/(image|reference)-to-video$/.test(parsed.modelId)
}

type ModeKey = 'i2v' | 'r2v'

function classifyMode(modelId: string): ModeKey {
  return modelId.endsWith('reference-to-video') ? 'r2v' : 'i2v'
}

function shortBlurb(full: string): string {
  if (!full) return ''
  const firstSentence = full.split(/[。．.]/)[0] || full
  const trimmed = firstSentence.trim()
  if (trimmed.length <= 80) return trimmed
  return trimmed.slice(0, 77) + '…'
}

function describeCharacterForPrompt(
  ref: CharacterRef,
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
  mode: ModeKey,
): string {
  if (mode === 'r2v') return ''
  const characters = projectData.characters as unknown as Array<{
    id: string
    name: string
    description?: string | null
    appearances?: Array<{ changeReason?: string | null }>
  }> | undefined
  const c = (characters ?? []).find((x) => x.id === ref.id)
  if (!c) return ''
  const appearance = c.appearances?.[0]
  const full = (appearance?.changeReason || c.description || '').trim()
  return shortBlurb(full)
}

function describeSceneForPrompt(
  ref: SceneRef,
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
  mode: ModeKey,
): string {
  if (mode === 'r2v') return ''
  const locations = projectData.locations as unknown as Array<{
    id: string
    name: string
    description?: string | null
  }> | undefined
  const loc = locations?.find((x) => x.id === ref.id)
  return shortBlurb((loc?.description || '').trim())
}

function describePropForPrompt(
  ref: PropRef,
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
  mode: ModeKey,
): string {
  if (mode === 'r2v') return ''
  const propsCatalog = projectData.props as unknown as Array<{
    id: string
    name: string
    summary?: string | null
    description?: string | null
  }> | undefined
  const prop = propsCatalog?.find((x) => x.id === ref.id)
  return shortBlurb((prop?.summary || prop?.description || '').trim())
}

/**
 * Build fal Seedance multi-shot prompt with @Image1/@Image2/... tags.
 *
 * For r2v: refs go in image_urls[] AND get @ImageN tags in prompt body.
 * For i2v: only one image (first_frame), no tags needed — prompt
 * inlines text descriptions for character/scene anchoring.
 */
function buildFalPrompt(
  panels: PanelLite[],
  mode: ModeKey,
  characterRefs: CharacterRef[],
  sceneRefs: SceneRef[],
  propRefs: PropRef[],
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
  r2vRefOrder: Array<{ kind: 'char' | 'scene' | 'prop'; ref: CharacterRef | SceneRef | PropRef }>,
): { prompt: string; dialogueBeatCount: number } {
  const sections: string[] = []

  // INLINE ANCHORS — i2v only (r2v uses ref-map below for identity).
  if (mode !== 'r2v') {
    const anchorLines: string[] = []
    for (const c of characterRefs) {
      const desc = describeCharacterForPrompt(c, projectData, mode)
      anchorLines.push(desc ? `角色「${c.name}」：${desc}` : `角色「${c.name}」`)
    }
    for (const s of sceneRefs) {
      const desc = describeSceneForPrompt(s, projectData, mode)
      anchorLines.push(desc ? `場景「${s.name}」：${desc}` : `場景「${s.name}」`)
    }
    for (const p of propRefs) {
      const desc = describePropForPrompt(p, projectData, mode)
      anchorLines.push(desc ? `道具「${p.name}」：${desc}` : `道具「${p.name}」`)
    }
    if (anchorLines.length > 0) sections.push(anchorLines.join('\n'))
  }

  // REF MAP (r2v only) — fal expects @Image1/@Image2... in prompt.
  if (mode === 'r2v' && r2vRefOrder.length > 0) {
    const mapLines = r2vRefOrder.map((entry, i) => {
      const label =
        entry.kind === 'char'
          ? `角色「${entry.ref.name}」`
          : entry.kind === 'scene'
            ? `場景「${entry.ref.name}」`
            : `道具「${entry.ref.name}」`
      return `@Image${i + 1} = ${label}`
    })
    sections.push(`參考圖對應 (use @ImageN to cite specific refs):\n${mapLines.join('\n')}`)
  }

  // SHOTS
  const shotLines: string[] = []
  let dialogueBeatCount = 0
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i]
    const shotNum = i + 1
    const desc = (panel.videoPrompt || panel.description || '').trim()
    const dialogue = (panel.srtSegment || '').trim()
    if (dialogue) dialogueBeatCount += 1
    const parts: string[] = []
    parts.push(`第${shotNum}鏡：${desc || '(無描述)'}`)
    if (dialogue) parts.push(`對白：${dialogue}`)
    shotLines.push(parts.join(' '))
  }
  sections.push(shotLines.join('\n'))

  // AUDIO DIRECTIVE
  const audioDirective =
    dialogueBeatCount > 0
      ? '音頻：原生輸出雙聲道，按對白逐字配音，背景疊加環境音；無字幕、無 logo、無屏幕信息。'
      : '音頻：輸出環境音與適配背景音樂，無對白；畫面無字幕、無 logo、無屏幕信息。'
  sections.push(audioDirective)

  return { prompt: sections.join('\n\n'), dialogueBeatCount }
}

export async function runMultiShotFalComposite(params: {
  job: Job<TaskJobData>
  projectId: string
  validPanels: PanelLite[]
  videoModel: string
  sound: boolean | undefined
  aspectRatio: string | undefined
  rawPrompt?: string
  panelDurations?: number[]
  /** Phase P (2026-05-21) — atomic total-duration override; see
   *  atlascloud-path for full rationale. */
  totalDurationSeconds?: number
  visualStyleId?: string
}): Promise<{
  storyboardId: string
  multiShotVideoUrl: string
  multiShotClipUrls: string[]
  chunkCount: number
  shotCount: number
  subjectCount: number
  path: 'fal-composite'
  mode: ModeKey
  bindings: {
    characters: Array<{ id: string; name: string; imageUrl: string }>
    scenes: Array<{ id: string; name: string; imageUrl: string }>
    props: Array<{ id: string; name: string; imageUrl: string }>
  }
}> {
  const { job, projectId, validPanels, videoModel } = params
  const sound = params.sound ?? true
  const aspectRatio = params.aspectRatio ?? '16:9'
  const { userId } = job.data
  const logger = createScopedLogger({
    module: 'worker.multi-shot-fal',
    action: 'multi_shot_fal_composite',
  })

  if (validPanels.length === 0) {
    throw new Error('FAL_COMPOSITE_NO_PANELS')
  }

  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed || parsed.provider !== 'fal') {
    throw new Error(`FAL_COMPOSITE_BAD_MODEL: ${videoModel}`)
  }
  const mode = classifyMode(parsed.modelId)

  await reportTaskProgress(job, 12, { stage: 'fal_composite_collect_refs' })

  // Episode-level appearance bindings (same as other vendor paths).
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

  const projectData = await resolveNovelData(projectId)
  const usedPanels = validPanels.slice(0, MAX_REFERENCE_IMAGES)

  const locOverrideById = new Map<string, string>()
  const characterRefs = collectCharacterRefs(usedPanels, projectData, episodeBindings)
  const sceneRefs = collectSceneRefs(usedPanels, projectData, locOverrideById)
  const propRefs = collectPropRefs(usedPanels, projectData)

  let firstFrameUrl: string | null = null
  let referenceImages: string[] = []
  let r2vRefOrder: Array<{ kind: 'char' | 'scene' | 'prop'; ref: CharacterRef | SceneRef | PropRef }> = []

  if (mode === 'r2v') {
    for (const c of characterRefs) {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) break
      referenceImages.push(c.imageUrl)
      r2vRefOrder.push({ kind: 'char', ref: c })
    }
    for (const s of sceneRefs) {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) break
      referenceImages.push(s.imageUrl)
      r2vRefOrder.push({ kind: 'scene', ref: s })
    }
    for (const p of propRefs) {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) break
      referenceImages.push(p.imageUrl)
      r2vRefOrder.push({ kind: 'prop', ref: p })
    }
    for (const p of usedPanels) {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) break
      if (!p.imageUrl) continue
      const signed = toSignedUrlIfCos(p.imageUrl, 7200)
      if (!signed) continue
      referenceImages.push(signed)
    }
    if (referenceImages.length === 0) {
      throw new Error('FAL_COMPOSITE_R2V_NO_REFERENCES')
    }
  } else {
    // i2v: first available panel image as first_frame, fall back to char ref.
    for (const p of usedPanels) {
      if (p.imageUrl) {
        const signed = toSignedUrlIfCos(p.imageUrl, 7200)
        if (signed) {
          firstFrameUrl = signed
          break
        }
      }
    }
    if (!firstFrameUrl && characterRefs[0]) {
      firstFrameUrl = characterRefs[0].imageUrl
    }
    if (!firstFrameUrl) {
      throw new Error('FAL_COMPOSITE_I2V_NO_FIRST_FRAME')
    }
  }

  // Visual style (Phase I parity)
  const resolvedStyle = params.visualStyleId
    ? (() => {
        const s = getStyleSafe(params.visualStyleId)
        return s ? { style: s, lighting: null } : null
      })()
    : await resolveProjectVisualStyle(prisma, projectId)
  const stylePrefix = buildVisualStylePrefix(resolvedStyle).trim()
  const styleSuffix = buildVisualStyleSuffix(resolvedStyle).trim()
  // Style-library negativePrompt (visual-style suppressors) still ships
  // as a separate annotation; clean-frame uses positive phrasing.
  const styleNegative = buildVisualStyleNegative(resolvedStyle).trim()

  // Prompt assembly
  let promptCore: string
  let dialogueBeatCount: number
  if (params.rawPrompt && params.rawPrompt.trim().length > 0) {
    promptCore = params.rawPrompt.trim()
    dialogueBeatCount = (promptCore.match(/對白：|说「|: "/g) || []).length
  } else {
    const built = buildFalPrompt(
      usedPanels,
      mode,
      characterRefs,
      sceneRefs,
      propRefs,
      projectData,
      r2vRefOrder,
    )
    promptCore = built.prompt
    dialogueBeatCount = built.dialogueBeatCount
  }

  const styleNegativeFragment = styleNegative
    ? `Visual style to AVOID (don't render in this style): ${styleNegative}.`
    : ''
  const prompt = [
    stylePrefix,
    promptCore,
    styleSuffix,
    styleNegativeFragment,
    UNIVERSAL_FAL_CLEAN_FRAME_DIRECTIVE,
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')

  // Duration — same priority chain as AtlasCloud (Phase M + Phase P).
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
      driven = buildDialogueDrivenDurations({
        panels: usedPanels,
        dialogueByPanelId: dialogueByPanel,
      })
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
      const baseline = Math.max(10, Math.round(usedPanels.length * 2.5))
      duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, baseline))
      durationSource = 'baseline'
    }
  }

  logger.info({
    message: 'fal composite submit',
    details: {
      storyboardId: validPanels[0].storyboardId,
      mode,
      modelId: parsed.modelId,
      panelsRequested: validPanels.length,
      panelsUsed: usedPanels.length,
      characterRefs: characterRefs.length,
      sceneRefs: sceneRefs.length,
      propRefs: propRefs.length,
      hasFirstFrame: Boolean(firstFrameUrl),
      referenceImageCount: referenceImages.length,
      duration,
      durationSource,
      aspectRatio,
      generateAudio: sound,
      dialogueBeatCount,
      promptLength: prompt.length,
      visualStyleId: resolvedStyle?.style.id ?? null,
      negativeLength: styleNegative.length,
      cleanFrameDirective: true,
    },
  })

  await assertTaskActive(job, 'fal_composite_submit')
  await reportTaskProgress(job, 20, { stage: 'fal_composite_submit' })

  const generator = new FalVideoGenerator()
  const generateResult = await generator.generate({
    userId,
    imageUrl: firstFrameUrl ?? '',
    prompt,
    options: {
      modelId: parsed.modelId,
      duration,
      aspectRatio,
      generateAudio: sound,
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
    },
  })

  if (!generateResult.success || !generateResult.externalId) {
    throw new Error(
      `FAL_COMPOSITE_SUBMIT_FAILED: ${generateResult.error ?? 'unknown'}`,
    )
  }

  await reportTaskProgress(job, 40, { stage: 'fal_composite_poll' })

  const polled = await waitExternalResult(job, generateResult.externalId, userId, {
    timeoutMs: 15 * 60 * 1000,
    progressStart: 40,
    progressEnd: 90,
  })

  if (!polled.url) {
    throw new Error('FAL_COMPOSITE_NO_RESULT_URL')
  }

  await reportTaskProgress(job, 92, { stage: 'fal_composite_persist' })

  const targetId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(
    polled.url,
    `multi-shot-fal/${targetId}`,
    targetId,
    polled.downloadHeaders,
  )

  await prisma.novelPromotionStoryboard.update({
    where: { id: targetId },
    data: buildMultiShotClipUpdate([cosKey]),
  })

  await reportTaskProgress(job, 98, { stage: 'fal_composite_done' })

  logger.info({
    message: 'fal composite persisted',
    details: {
      storyboardId: targetId,
      cosKey,
      mode,
      panelsUsed: usedPanels.length,
      characterRefs: characterRefs.length,
      sceneRefs: sceneRefs.length,
      propRefs: propRefs.length,
    },
  })

  return {
    storyboardId: targetId,
    multiShotVideoUrl: cosKey,
    multiShotClipUrls: [cosKey],
    chunkCount: 1,
    shotCount: usedPanels.length,
    subjectCount: characterRefs.length + sceneRefs.length + propRefs.length,
    path: 'fal-composite',
    mode,
    bindings: {
      characters: characterRefs.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      scenes: sceneRefs.map((s) => ({ id: s.id, name: s.name, imageUrl: s.imageUrl })),
      props: propRefs.map((p) => ({ id: p.id, name: p.name, imageUrl: p.imageUrl })),
    },
  }
}
