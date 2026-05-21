/**
 * AtlasCloud "composite" path for multi-shot video.
 *
 * Different from the BobAPI Seedance composite path (which uses
 * content[] @N references) and the Tencent VOD Kling B path (which
 * uses SubjectInfos + multi_shot=intelligence). AtlasCloud Seedance
 * 2.0 exposes three endpoints and the multi-shot capability is in
 * the MODEL, not the endpoint — the prompt itself encodes the shot
 * breakdown:
 *
 *   "第一鏡：…  第二鏡：…  第三鏡：…"
 *
 * Each endpoint takes a different anchor type:
 *   - text-to-video       (t2v): NO image inputs at all. Identity is
 *                                anchored via INLINE descriptions in
 *                                the prompt ("Karrug — 戴眼罩的部落
 *                                祭司，黑髮黑鬚，紋面…").
 *   - image-to-video      (i2v): one first_frame image + prompt. Other
 *                                refs still get inlined as text since
 *                                the API only takes one image slot.
 *   - reference-to-video  (r2v): 1-9 reference_images[] + prompt. Refs
 *                                cited as "image 1" / "image 2".
 *
 * Refs sourced through the shared collector (char + scene + prop):
 * see multi-shot-ref-collection.ts. Caps mirror BobAPI seedance-path:
 *   - characters: 4
 *   - scenes:     2
 *   - props:      3   (NEW — BobAPI seedance composite never collected
 *                      props; that path's refs are characters + scenes
 *                      only. Atlascloud r2v has slot headroom so we
 *                      include props.)
 *
 * Output: ONE composite mp4 stored as the storyboard's
 * `multiShotVideoUrl` + single-element `multiShotClipUrls`. Same
 * persistence shape as BobAPI / Kling B paths so the existing
 * MultiShotBindingsRail UI renders without frontend changes.
 */

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { AtlasCloudSeedanceVideoGenerator } from '@/lib/generators/video/atlascloud'
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

// AtlasCloud Seedance 2.0's request schema has NO `negative_prompt`
// field (verified from static.atlascloud.ai/model/schema/...). Inline
// the negatives into the prompt with an explicit AVOID marker so the
// model still suppresses CG / animation artifacts. Matches the
// fallback the BobAPI generator does when its negative_prompt slot
// goes empty.
const UNIVERSAL_ATLASCLOUD_NEGATIVE = [
  'subtitles',
  'on-screen text',
  'watermark',
  'logo',
  '字幕',
  '文字',
  '屏幕信息',
  '水印',
].join(', ')

const MAX_REFERENCE_IMAGES = 9
const MIN_DURATION_SEC = 4
const MAX_DURATION_SEC = 15

interface PanelLite {
  id: string
  imageUrl: string | null
  description: string | null
  videoPrompt: string | null
  characters: string | null
  /** panel.props JSON — used by collectPropRefs. */
  props: string | null
  location: string | null
  srtSegment: string | null
  storyboardId: string
}

/**
 * True when this videoModel routes to AtlasCloud composite (any of the
 * 6 Seedance 2.0 variants — t2v / i2v / r2v × std / fast).
 */
export function shouldUseAtlasCloudComposite(videoModel: string): boolean {
  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed) return false
  if (parsed.provider !== 'atlascloud') return false
  return /^seedance-2\.0/.test(parsed.modelId)
}

type ModeKey = 't2v' | 'i2v' | 'r2v'

function classifyMode(modelId: string): ModeKey {
  if (modelId.endsWith('-r2v')) return 'r2v'
  if (modelId.endsWith('-t2v')) return 't2v'
  return 'i2v'
}

/**
 * Fetch character description from project catalog for inline-anchor
 * text injection. Used by t2v / i2v modes where we cannot pass the
 * actual reference image — embedding the look-description into the
 * prompt is the only way to anchor identity.
 *
 * Returns the appearance.changeReason (which carries the curated
 * visual description) when present, otherwise falls back to
 * character.description (looser blurb). Empty string if neither.
 */
function describeCharacterForPrompt(
  ref: CharacterRef,
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
): string {
  // CharacterLike on the shared type intentionally narrows away
  // `description` (image handlers don't need it); the prisma include
  // carries it at runtime — cast like b-path does for similar cases.
  const characters = projectData.characters as unknown as Array<{
    id: string
    name: string
    description?: string | null
    appearances?: Array<{ changeReason?: string | null }>
  }> | undefined
  const c = (characters ?? []).find((x) => x.id === ref.id)
  if (!c) return ''
  const appearance = c.appearances?.[0]
  const blurb = (appearance?.changeReason || c.description || '').trim()
  return blurb
}

function describeSceneForPrompt(
  ref: SceneRef,
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
): string {
  const locations = projectData.locations as unknown as Array<{
    id: string
    name: string
    description?: string | null
  }> | undefined
  const loc = locations?.find((x) => x.id === ref.id)
  return (loc?.description || '').trim()
}

function describePropForPrompt(
  ref: PropRef,
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
): string {
  const propsCatalog = projectData.props as unknown as Array<{
    id: string
    name: string
    summary?: string | null
    description?: string | null
  }> | undefined
  const prop = propsCatalog?.find((x) => x.id === ref.id)
  // Prefer human-facing summary; fall back to AI prompt description.
  return (prop?.summary || prop?.description || '').trim()
}

/**
 * Build a single multi-shot prompt for Seedance 2.0.
 *
 * Layout:
 *   [INLINE ANCHORS]    Character / scene / prop descriptions inlined
 *                       so t2v / i2v can still anchor identity even
 *                       without (enough) image slots. r2v also keeps
 *                       this so the @image-N markers + description
 *                       work together.
 *   [REF MAP]           r2v only — explicit "image 1 = 角色 X" mapping
 *                       so the model knows which slot is which.
 *   [SHOTS]             "第N鏡：{videoPrompt} [對白：{srt}]" lines.
 *   [AUDIO DIRECTIVE]   TTS-on if any panel has dialogue, ambient-only
 *                       otherwise.
 */
function buildAtlasCloudPrompt(
  panels: PanelLite[],
  mode: ModeKey,
  characterRefs: CharacterRef[],
  sceneRefs: SceneRef[],
  propRefs: PropRef[],
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
  /** Ordered refs used as reference_images[] for r2v mode. */
  r2vRefOrder: Array<{ kind: 'char' | 'scene' | 'prop'; ref: CharacterRef | SceneRef | PropRef }>,
): { prompt: string; dialogueBeatCount: number } {
  const sections: string[] = []

  // ── INLINE ANCHORS ──
  // Char / scene / prop descriptions. These are TEXT-LEVEL identity
  // hooks; they work in all 3 modes. r2v additionally pushes the
  // images themselves, but text descriptions stay so the model has
  // both anchors (visual + linguistic).
  const anchorLines: string[] = []
  if (characterRefs.length > 0) {
    for (const c of characterRefs) {
      const desc = describeCharacterForPrompt(c, projectData)
      anchorLines.push(desc ? `角色「${c.name}」：${desc}` : `角色「${c.name}」`)
    }
  }
  if (sceneRefs.length > 0) {
    for (const s of sceneRefs) {
      const desc = describeSceneForPrompt(s, projectData)
      anchorLines.push(desc ? `場景「${s.name}」：${desc}` : `場景「${s.name}」`)
    }
  }
  if (propRefs.length > 0) {
    for (const p of propRefs) {
      const desc = describePropForPrompt(p, projectData)
      anchorLines.push(desc ? `道具「${p.name}」：${desc}` : `道具「${p.name}」`)
    }
  }
  if (anchorLines.length > 0) {
    sections.push(anchorLines.join('\n'))
  }

  // ── REF MAP (r2v only) ──
  if (mode === 'r2v' && r2vRefOrder.length > 0) {
    const mapLines = r2vRefOrder.map((entry, i) => {
      const label =
        entry.kind === 'char'
          ? `角色「${entry.ref.name}」`
          : entry.kind === 'scene'
            ? `場景「${entry.ref.name}」`
            : `道具「${entry.ref.name}」`
      return `image ${i + 1} = ${label}`
    })
    sections.push(`參考圖對應：\n${mapLines.join('\n')}`)
  }

  // ── SHOTS ──
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

  // ── AUDIO DIRECTIVE ──
  const audioDirective =
    dialogueBeatCount > 0
      ? '音頻：原生輸出雙聲道，按上述對白逐字配音（語氣、停頓、情緒與角色一致），'
        + '唇形與配音嚴格同步；背景疊加場景對應的環境音；無字幕、無 logo、無屏幕信息。'
      : '音頻：輸出場景對應的環境音與適配背景音樂，本組無對白請勿合成說話聲；'
        + '畫面無字幕、無 logo、無屏幕信息。'
  sections.push(audioDirective)

  return { prompt: sections.join('\n\n'), dialogueBeatCount }
}

export async function runMultiShotAtlasCloudComposite(params: {
  job: Job<TaskJobData>
  projectId: string
  validPanels: PanelLite[]
  videoModel: string
  sound: boolean | undefined
  aspectRatio: string | undefined
  rawPrompt?: string
  panelDurations?: number[]
  /** Per-group curated visual style override (Phase E parity with
   *  Kling B-path and BobAPI seedance-path). When set, wins over
   *  project.visualStyleId in resolveProjectVisualStyle. */
  visualStyleId?: string
}): Promise<{
  storyboardId: string
  multiShotVideoUrl: string
  multiShotClipUrls: string[]
  chunkCount: number
  shotCount: number
  subjectCount: number
  path: 'atlascloud-composite'
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
    module: 'worker.multi-shot-atlascloud',
    action: 'multi_shot_atlascloud_composite',
  })

  if (validPanels.length === 0) {
    throw new Error('ATLASCLOUD_COMPOSITE_NO_PANELS')
  }

  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed || parsed.provider !== 'atlascloud') {
    throw new Error(`ATLASCLOUD_COMPOSITE_BAD_MODEL: ${videoModel}`)
  }
  const mode = classifyMode(parsed.modelId)

  await reportTaskProgress(job, 12, { stage: 'atlascloud_composite_collect_refs' })

  // Episode-level appearance bindings (same shape as BobAPI path).
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

  // ── REFS — collect ALL three types for every mode ──
  // t2v / i2v use them as INLINE TEXT anchors; r2v also pushes them
  // as reference_images[]. Either way the bindings response surfaces
  // what the worker had access to, so the chip rail stays accurate.
  const locOverrideById = new Map<string, string>() // no per-call override surface yet
  const characterRefs = collectCharacterRefs(usedPanels, projectData, episodeBindings)
  const sceneRefs = collectSceneRefs(usedPanels, projectData, locOverrideById)
  const propRefs = collectPropRefs(usedPanels, projectData)

  // ── MODE-SPECIFIC MEDIA ASSEMBLY ──
  let firstFrameUrl: string | null = null
  let referenceImages: string[] = []
  let r2vRefOrder: Array<{ kind: 'char' | 'scene' | 'prop'; ref: CharacterRef | SceneRef | PropRef }> = []

  if (mode === 'r2v') {
    // Slot priority: char → scene → prop → panel (up to 9 total).
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
    // Panel images fill remaining slots (composition anchors).
    for (const p of usedPanels) {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) break
      if (!p.imageUrl) continue
      const signed = toSignedUrlIfCos(p.imageUrl, 7200)
      if (!signed) continue
      referenceImages.push(signed)
      // Panel images stay unnamed in the ref-map (would just confuse
      // the model — they're composition anchors, not character refs).
    }
    if (referenceImages.length === 0) {
      throw new Error('ATLASCLOUD_COMPOSITE_R2V_NO_REFERENCES')
    }
  } else if (mode === 'i2v') {
    // i2v: first available panel image as first_frame. Fall back to
    // the first character ref so identity still anchors. Text-level
    // anchors (description in prompt) carry the rest.
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
      throw new Error('ATLASCLOUD_COMPOSITE_I2V_NO_FIRST_FRAME')
    }
  }
  // t2v: no media; identity anchored purely via inline prompt descriptions.

  // ── VISUAL STYLE (Phase I — parity with Kling B-path + BobAPI seedance) ──
  // Priority: per-call params.visualStyleId → project.visualStyleId →
  // null (falls back to no style enrichment, current pre-Phase-I behavior).
  // Style anchor + visualModifiers wrap the prompt; the curated negativePrompt
  // is inlined as "AVOID: ..." because AtlasCloud Seedance 2.0's API schema
  // has no negative_prompt body field.
  const resolvedStyle = params.visualStyleId
    ? (() => {
        const s = getStyleSafe(params.visualStyleId)
        return s ? { style: s, lighting: null } : null
      })()
    : await resolveProjectVisualStyle(prisma, projectId)

  const stylePrefix = buildVisualStylePrefix(resolvedStyle).trim()
  const styleSuffix = buildVisualStyleSuffix(resolvedStyle).trim()
  const styleNegative = buildVisualStyleNegative(resolvedStyle).trim()
  const composedNegative = [styleNegative, UNIVERSAL_ATLASCLOUD_NEGATIVE]
    .filter((s) => s && s.length > 0)
    .join(', ')

  // ── PROMPT ASSEMBLY ──
  let promptCore: string
  let dialogueBeatCount: number
  if (params.rawPrompt && params.rawPrompt.trim().length > 0) {
    // User-edited rawPrompt wins; ships verbatim. The Group Card's
    // textarea is already the source of truth for the user's review
    // ("what I see is what runs"). We trust the user to align it with
    // the selected mode (e.g. don't reference @image-3 on t2v).
    promptCore = params.rawPrompt.trim()
    dialogueBeatCount = (promptCore.match(/對白：|说「|: "/g) || []).length
  } else {
    const built = buildAtlasCloudPrompt(
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

  // Wrap: styleAnchor + lighting → core → visualModifiers → AVOID list.
  // Match Kling B-path's official ordering (Scene → Action → Style →
  // Negative-as-text). Even when style is null, the universal AVOID
  // list still ships so on-screen-text / watermark artifacts get
  // suppressed across all 3 modes.
  const prompt = [
    stylePrefix,
    promptCore,
    styleSuffix,
    composedNegative ? `AVOID: ${composedNegative}.` : '',
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')

  // ── DURATION ──
  let duration: number
  if (params.panelDurations && params.panelDurations.length > 0) {
    const sum = params.panelDurations.reduce((s, d) => s + (Number.isFinite(d) ? d : 0), 0)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(sum)))
  } else {
    const baseline = Math.round(usedPanels.length * 2)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, baseline))
  }

  logger.info({
    message: 'AtlasCloud composite submit',
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
      aspectRatio,
      generateAudio: sound,
      dialogueBeatCount,
      promptLength: prompt.length,
      visualStyleId: resolvedStyle?.style.id ?? null,
      negativeLength: composedNegative.length,
    },
  })

  await assertTaskActive(job, 'atlascloud_composite_submit')
  await reportTaskProgress(job, 20, { stage: 'atlascloud_composite_submit' })

  const generator = new AtlasCloudSeedanceVideoGenerator()
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
      `ATLASCLOUD_COMPOSITE_SUBMIT_FAILED: ${generateResult.error ?? 'unknown'}`,
    )
  }

  await reportTaskProgress(job, 40, { stage: 'atlascloud_composite_poll' })

  const polled = await waitExternalResult(job, generateResult.externalId, userId, {
    timeoutMs: 15 * 60 * 1000,
    progressStart: 40,
    progressEnd: 90,
  })

  if (!polled.url) {
    throw new Error('ATLASCLOUD_COMPOSITE_NO_RESULT_URL')
  }

  await reportTaskProgress(job, 92, { stage: 'atlascloud_composite_persist' })

  const targetId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(
    polled.url,
    `multi-shot-atlascloud/${targetId}`,
    targetId,
    polled.downloadHeaders,
  )

  await prisma.novelPromotionStoryboard.update({
    where: { id: targetId },
    data: buildMultiShotClipUpdate([cosKey]),
  })

  await reportTaskProgress(job, 98, { stage: 'atlascloud_composite_done' })

  logger.info({
    message: 'AtlasCloud composite persisted',
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
    path: 'atlascloud-composite',
    mode,
    bindings: {
      characters: characterRefs.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      scenes: sceneRefs.map((s) => ({ id: s.id, name: s.name, imageUrl: s.imageUrl })),
      props: propRefs.map((p) => ({ id: p.id, name: p.name, imageUrl: p.imageUrl })),
    },
  }
}
