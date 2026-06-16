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
import { buildAudioDirective } from './multi-shot-audio-directive'
import { getMultiShotDurationWindow } from './multi-shot-duration-window'
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
import {
  buildDialogueDrivenDurations,
  estimateSilentActionSeconds,
} from './speech-duration-estimator'
import { extractSpokenLineFromSrtSegment } from './multi-shot-video-b-path'

// AtlasCloud Seedance 2.0's request schema has NO `negative_prompt`
// field (verified from static.atlascloud.ai/model/schema/...). User
// reported (2026-05-22) that the previous "AVOID: 字幕, 文字, ..."
// inline-negative approach BACKFIRED — Seedance models occasionally
// render the AVOID list itself as on-screen text (a known "pink
// elephant" failure mode: mentioning 字幕 in any context primes the
// model to paint subtitles).
//
// Phase R-1 fix: switch to a POSITIVE aspirational phrasing that
// describes the desired clean frame without ever naming the artifact
// we're suppressing. Style-library's `negativePrompt` (per-style CG
// suppressors) STILL ships via buildVisualStyleNegative because those
// terms (animation/3D render/plastic skin) are recognised as visual
// styles by the model, not as text-to-render. Only the "字幕 / 文字 /
// watermark" trio gets the positive-phrasing treatment.
const UNIVERSAL_ATLASCLOUD_CLEAN_FRAME_DIRECTIVE =
  '純電影級實拍畫面,畫面內僅包含敘事主體與環境,無任何文字疊加 / 圖形 UI 覆蓋 / 浮水印 / 角標 / 平台 logo,畫面整潔乾淨,模擬無後製字幕的純拍攝素材。'

const MAX_REFERENCE_IMAGES = 9
// Phase 1.5C: duration window from the shared per-provider module.
const ATLASCLOUD_WINDOW = getMultiShotDurationWindow('atlascloud')
const MIN_DURATION_SEC = ATLASCLOUD_WINDOW.minTotalSec
const MAX_DURATION_SEC = ATLASCLOUD_WINDOW.maxTotalSec
/** Floor for a single shot's airtime when sizing an all-silent group by
 *  action density — keeps a hold shot from collapsing under 2s. */
const MIN_PER_SHOT_SEC = 2

/** Soft token budget for the composite prompt. Seedance has no published
 *  hard cap, but empirically past ~2200 tokens the model starts dropping
 *  late-shot narrative and ignoring the audio directive (multi-role review
 *  2026-05-30). We don't truncate user content — we WARN so the "rich
 *  description, tail swallowed" failure is observable in logs. */
export const PROMPT_TOKEN_WARN_THRESHOLD = 2200

/** Rough token estimate. CJK averages ~1 token/char; Latin/spaces ~0.3
 *  token/char. Good enough to flag a runaway prompt without a tokenizer
 *  dependency in the worker. */
export function estimatePromptTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[㐀-鿿豈-﫿぀-ヿ]/.test(ch)) cjk += 1
    else other += 1
  }
  return Math.round(cjk + other * 0.3)
}

/** True when the assembled prompt is long enough to risk tail-truncation. */
export function isPromptLengthRisky(prompt: string): boolean {
  return estimatePromptTokens(prompt) > PROMPT_TOKEN_WARN_THRESHOLD
}

// buildAudioDirective moved to the shared ./multi-shot-audio-directive module
// (2026-06-03) so atlascloud / seedance / ark / fal can't drift. Imported
// above; re-exported here for back-compat with callers/tests that import it
// from this path.
export { buildAudioDirective }

/**
 * Compose the hand-edited rawPrompt with its r2v scaffold (ref-map
 * prepended, timing-guide appended) WITHOUT duplicating a section the
 * user already hand-wrote. If the textarea already contains "參考圖對應"
 * we skip the generated ref-map; same for "鏡頭時長分配" and the timing
 * guide. Prevents double ref-maps / double timing tables (token waste +
 * model confusion) reported by the multi-role review 2026-05-30.
 */
export function composeRawPromptScaffold(
  raw: string,
  refMap: string,
  timingGuide: string,
): string {
  const prefix = refMap && !raw.includes('參考圖對應') ? refMap : ''
  const suffix = timingGuide && !raw.includes('鏡頭時長分配') ? timingGuide : ''
  return [prefix, raw, suffix].filter((s) => s.length > 0).join('\n\n')
}

type R2vRefEntry = { kind: 'char' | 'scene' | 'prop'; ref: CharacterRef | SceneRef | PropRef }

/**
 * Build the r2v "參考圖對應" mapping section that tells the model which
 * reference_images[] slot is which subject ("image 1 = 角色「Vera」").
 *
 * Extracted (2026-05-28) so BOTH the auto-built prompt AND the user's
 * hand-edited rawPrompt can emit it. Previously the rawPrompt branch
 * skipped buildAtlasCloudPrompt entirely, so a user who wrote
 * "黑貓落地幻化成 @Vera" shipped a bare @Vera token with no image
 * binding — the model had no idea which reference image was Vera.
 *
 * Returns '' when there are no ordered refs (t2v/i2v, or no refs at all).
 */
function buildR2vRefMapSection(r2vRefOrder: R2vRefEntry[]): string {
  if (r2vRefOrder.length === 0) return ''
  const mapLines = r2vRefOrder.map((entry, i) => {
    const label =
      entry.kind === 'char'
        ? `角色「${entry.ref.name}」`
        : entry.kind === 'scene'
          ? `場景「${entry.ref.name}」`
          : `道具「${entry.ref.name}」`
    return `image ${i + 1} = ${label}`
  })
  return `參考圖對應：\n${mapLines.join('\n')}`
}

/**
 * Build a per-shot timing guide appended to a user's hand-edited
 * rawPrompt (2026-05-28). The auto-built prompt inlines "（約Xs）" on
 * each 第N鏡 line; the rawPrompt is verbatim user text so we can't
 * inject inline — instead we append an explicit allocation table so
 * Seedance doesn't starve a silent action shot by handing its seconds
 * to a dialogue shot. Returns '' for <2 shots (nothing to allocate).
 */
function buildPerShotDurationGuide(perShotDurations: number[]): string {
  if (perShotDurations.length < 2) return ''
  const parts = perShotDurations.map((sec, i) => `第${i + 1}鏡約${sec}秒`)
  const total = perShotDurations.reduce((a, b) => a + b, 0)
  return (
    `鏡頭時長分配（請嚴格按此節奏分配畫面時間，每一鏡必須完整演完其主要動作後才切下一鏡，`
    + `不可為了趕後面的鏡頭而省略前一鏡的動作）：${parts.join('、')}，全片約${total}秒。`
  )
}

/** Distribute a total duration as evenly as possible into n whole-second
 *  slots (remainder spread onto the earliest shots). Used to derive
 *  per-shot hints when the duration source isn't dialogue-driven. */
function distributeEvenSeconds(total: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(total / n)
  let remainder = total - base * n
  return Array.from({ length: n }, () => {
    const extra = remainder > 0 ? 1 : 0
    if (remainder > 0) remainder -= 1
    return base + extra
  })
}

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
 * Truncate a full description down to a single short sentence for i2v
 * mode. r2v doesn't call this (image refs carry identity). t2v gets
 * the full thing untouched. Heuristics:
 *   1. Take everything before the first 。/. — usually 1 visual beat
 *   2. Hard-cap at 80 chars to keep things lean
 *   3. Drop trailing punctuation
 */
function shortBlurb(full: string): string {
  if (!full) return ''
  const firstSentence = full.split(/[。．.]/)[0] || full
  const trimmed = firstSentence.trim()
  if (trimmed.length <= 80) return trimmed
  return trimmed.slice(0, 77) + '…'
}

/**
 * Mode-aware character anchor density (Phase L, 2026-05-20):
 *
 *   r2v: returns '' — the ref-map line ("image N = 角色「X」") already
 *        gives the model an identity hook, and reference_images[N]
 *        carries the visual description directly. Adding a verbose
 *        text description risks contradicting the image (hair color,
 *        clothing mismatch) and crowds out camera/composition language.
 *
 *   i2v: returns a 1-sentence ≤80 char blurb. first_frame anchors the
 *        opening look but subsequent shots in the 4-15s window drift —
 *        text anchor reinforces identity without bloating prompt.
 *
 *   t2v: returns the full description. With no image input at all,
 *        text IS the identity — needs the curated appearance.changeReason
 *        (preferred) or character.description for the model to anchor.
 *
 * Empty string when no curated description exists in the project catalog.
 */
function describeCharacterForPrompt(
  ref: CharacterRef,
  projectData: Awaited<ReturnType<typeof resolveNovelData>>,
  mode: ModeKey,
): string {
  if (mode === 'r2v') return ''
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
  const full = (appearance?.changeReason || c.description || '').trim()
  return mode === 'i2v' ? shortBlurb(full) : full
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
  const full = (loc?.description || '').trim()
  return mode === 'i2v' ? shortBlurb(full) : full
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
  // Prefer human-facing summary; fall back to AI prompt description.
  const full = (prop?.summary || prop?.description || '').trim()
  return mode === 'i2v' ? shortBlurb(full) : full
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
  r2vRefOrder: R2vRefEntry[],
  /** Per-shot duration hint (seconds), aligned to `panels` order. When
   *  provided, each 第N鏡 line is annotated "（約Xs）" so Seedance knows
   *  the time budget per shot and won't starve action-heavy shots. */
  perShotDurations?: number[],
  /** Whether native audio is requested. When false the audio directive
   *  switches to the silent branch — without this a dialogue group whose
   *  audio is toggled off still tells the model "逐字配音 + 唇形同步" while
   *  generateAudio is false (lost TTS + lip desync). */
  soundEnabled: boolean = true,
): { prompt: string; dialogueBeatCount: number } {
  const sections: string[] = []

  // ── INLINE ANCHORS (Phase L — mode-aware density) ──
  // r2v skips anchor lines entirely: the ref-map below ("image N = 角色「X」")
  // plus reference_images[N] in the API request together carry visual
  // identity. Duplicating it as long text risks contradicting the image
  // (e.g. catalog description says 黑髮 but ref image is 棕髮) and crowds
  // out camera / composition language in the prompt.
  //
  // i2v adds short 1-sentence anchors so the model has a text reinforcement
  // for shots that drift past the first_frame anchor.
  //
  // t2v ships full master-sheet descriptions — text is the ONLY identity
  // hook when no image is sent.
  if (mode !== 'r2v') {
    const anchorLines: string[] = []
    if (characterRefs.length > 0) {
      for (const c of characterRefs) {
        const desc = describeCharacterForPrompt(c, projectData, mode)
        anchorLines.push(desc ? `角色「${c.name}」：${desc}` : `角色「${c.name}」`)
      }
    }
    if (sceneRefs.length > 0) {
      for (const s of sceneRefs) {
        const desc = describeSceneForPrompt(s, projectData, mode)
        anchorLines.push(desc ? `場景「${s.name}」：${desc}` : `場景「${s.name}」`)
      }
    }
    if (propRefs.length > 0) {
      for (const p of propRefs) {
        const desc = describePropForPrompt(p, projectData, mode)
        anchorLines.push(desc ? `道具「${p.name}」：${desc}` : `道具「${p.name}」`)
      }
    }
    if (anchorLines.length > 0) {
      sections.push(anchorLines.join('\n'))
    }
  }

  // ── REF MAP (r2v only) ──
  if (mode === 'r2v') {
    const refMap = buildR2vRefMapSection(r2vRefOrder)
    if (refMap) sections.push(refMap)
  }

  // ── SHOTS ──
  const shotLines: string[] = []
  let dialogueBeatCount = 0
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i]
    const shotNum = i + 1
    // 2026-05-29 — description FIRST (was videoPrompt||description). description
    // now carries the full five-element rich structure WITH character names;
    // videoPrompt is the legacy T2I-era field that strips names to 年龄段+性别.
    // R2V binds names→images via the ref-map, so the named-rich description is
    // the correct source. Was shadowing the description-richness upgrade.
    // Matches b-path (already description-first). videoPrompt = fallback only.
    const desc = (panel.description || panel.videoPrompt || '').trim()
    const dialogue = (panel.srtSegment || '').trim()
    if (dialogue) dialogueBeatCount += 1

    const parts: string[] = []
    const durHint =
      perShotDurations && Number.isFinite(perShotDurations[i])
        ? `（約${perShotDurations[i]}秒）`
        : ''
    parts.push(`第${shotNum}鏡${durHint}：${desc || '(無描述)'}`)
    if (dialogue) parts.push(`對白：${dialogue}`)
    shotLines.push(parts.join(' '))
  }
  sections.push(shotLines.join('\n'))

  // ── AUDIO DIRECTIVE ──
  sections.push(buildAudioDirective(dialogueBeatCount, soundEnabled))

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
  /** Phase P (2026-05-21) — user's intended total duration (5-15s).
   *  Forwarded even when panelDurations is omitted (sendRaw=true gate).
   *  Used as tier-1.5 fallback before dialogue-driven heuristic.
   *  Pre-clamped by the dispatcher; worker re-clamps defensively. */
  totalDurationSeconds?: number
  /** Per-group curated visual style override (Phase E parity with
   *  Kling B-path and BobAPI seedance-path). When set, wins over
   *  project.visualStyleId in resolveProjectVisualStyle. */
  visualStyleId?: string
  /** Per-call character appearance overrides ("swap costume" from the
   *  bindings rail). characterId → appearanceId. Wins over the episode
   *  binding so a user who switches William to 半裸 actually gets that
   *  appearance's reference image. 2026-05-28 — was silently dropped on
   *  this path (parity gap with seedance/ark/b paths). */
  characterOverrides?: Array<{ characterId: string; appearanceId?: string }>
  /** Per-call location view overrides ("swap scene view" from the bindings
   *  rail). locationId → viewName. Wins over the panel's default view.
   *  2026-05-28 — wired for parity with seedance/ark paths (was a hardcoded
   *  empty map before). */
  locationOverrides?: Array<{ locationId: string; viewName?: string }>
  /** 2026-06-16 — resolution choice forwarded from the dispatcher. The
   *  AtlasCloud generator takes a flat `resolution` body field (default
   *  '720p'); this surfaces the project-level NovelPromotionProject.
   *  videoResolution to the r2v variant so the user's 720p/1080p pick is
   *  honored instead of silently baked to 720p. Resolved + validated
   *  upstream in multi-shot-video-handler; omitted → generator default. */
  resolution?: '480p' | '720p' | '1080p'
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
  // Phase S — per-group motion/camera reference video. Selected in the
  // same findUnique to avoid an extra round-trip. Signed for fal/AtlasCloud
  // body consumption; null when user hasn't uploaded one.
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

  // Per-call character appearance overrides ("swap costume" from the
  // bindings rail) win over the episode binding — same merge order as
  // seedance-path. Without this the AtlasCloud path silently ignored the
  // override and rendered the default appearance (2026-05-28 fix: user
  // switched William to 半裸 but kept getting the full-suit default).
  for (const o of params.characterOverrides ?? []) {
    if (o.characterId && o.appearanceId) episodeBindings.set(o.characterId, o.appearanceId)
  }

  const projectData = await resolveNovelData(projectId)
  const usedPanels = validPanels.slice(0, MAX_REFERENCE_IMAGES)

  // ── REFS — collect ALL three types for every mode ──
  // t2v / i2v use them as INLINE TEXT anchors; r2v also pushes them
  // as reference_images[]. Either way the bindings response surfaces
  // what the worker had access to, so the chip rail stays accurate.
  const locOverrideById = new Map<string, string>()
  for (const o of params.locationOverrides ?? []) {
    if (o.locationId && o.viewName) locOverrideById.set(o.locationId, o.viewName)
  }
  // Pass the hand-edited rawPrompt as extra mining text so a character
  // named only in the narrative ("@Vera") still resolves to a reference
  // image even when the storyboard parser never wrote them into
  // panel.characters (2026-05-28).
  const characterRefs = collectCharacterRefs(
    usedPanels,
    projectData,
    episodeBindings,
    undefined,
    params.rawPrompt,
  )
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
  // Style-library's per-style negativePrompt (animation/3D render/plastic
  // skin etc.) still ships as a negative annotation — those terms are
  // visual-style descriptors the model interprets as "don't render in
  // this style", not as literal text to paint. The on-screen-text /
  // watermark suppression has moved to UNIVERSAL_ATLASCLOUD_CLEAN_FRAME_DIRECTIVE
  // (positive phrasing) to avoid the 字幕→"無字幕" backfire.
  const styleNegative = buildVisualStyleNegative(resolvedStyle).trim()

  // ── DURATION (Phase M dialogue-driven + Phase X action-density, 2026-05-28) ──
  // Computed BEFORE prompt assembly so per-shot seconds can be injected
  // into the prompt ("第N鏡（約Xs）" / a timing guide on rawPrompt). This
  // is the core fix for "only the first action renders": a silent shot
  // packed with sequential actions (cat leaps → morphs → walks → touches)
  // used to get the flat 3s floor and Seedance dropped everything after
  // the first beat. We now floor each shot by its action density.
  //
  // Priority:
  //   1. params.panelDurations — explicit user override (UI 时长 dropdown).
  //   1.5 params.totalDurationSeconds — atomic override (survives sendRaw).
  //   2. buildDialogueDrivenDurations() — speech seconds + action floors.
  //   3. Action-density / baseline split when NOTHING has dialogue.
  // Each tier also yields `perShotDurations` (aligned to usedPanels).
  const actionSecondsByPanelId = new Map<string, number>()
  for (const panel of usedPanels) {
    const sec = estimateSilentActionSeconds(panel.description || panel.videoPrompt || '')
    if (sec > 0) actionSecondsByPanelId.set(panel.id, sec)
  }

  let duration: number
  let durationSource: 'panelDurations' | 'totalDurationSeconds' | 'dialogueDriven' | 'baseline'
  let perShotDurations: number[]
  if (params.panelDurations && params.panelDurations.length > 0) {
    const rounded = params.panelDurations.map((d) => Math.max(1, Math.round(Number.isFinite(d) ? d : 0)))
    const sum = rounded.reduce((s, d) => s + d, 0)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(sum)))
    perShotDurations =
      rounded.length === usedPanels.length ? rounded : distributeEvenSeconds(duration, usedPanels.length)
    durationSource = 'panelDurations'
  } else if (typeof params.totalDurationSeconds === 'number' && params.totalDurationSeconds > 0) {
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(params.totalDurationSeconds)))
    perShotDurations = distributeEvenSeconds(duration, usedPanels.length)
    durationSource = 'totalDurationSeconds'
  } else {
    // Build dialogueByPanel from srtSegment (same source b-path uses).
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
        actionSecondsByPanelId,
      })
    } catch (err) {
      // DIALOGUE_EXCEEDS_KLING_BUDGET — fall through to baseline (cap will
      // clamp). User can fix by shortening dialogue or splitting the group.
      const message = (err as Error)?.message ?? ''
      logger.warn({
        message: 'buildDialogueDrivenDurations failed, falling back to baseline',
        details: { error: message },
      })
    }

    if (driven && driven.hasDialogue) {
      duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, driven.totalDuration))
      perShotDurations = driven.durations
      durationSource = 'dialogueDriven'
    } else {
      // No dialogue anywhere. Size each shot by its action density; shots
      // with no detected action beats get a per-panel baseline share so a
      // plain hold shot still reads. Scale down proportionally if the sum
      // overruns the 15s cap (each shot kept ≥ MIN_PER_SHOT_SEC).
      const baseline = Math.max(10, Math.round(usedPanels.length * 2.5))
      const baselineShare = Math.max(MIN_PER_SHOT_SEC, Math.round(baseline / usedPanels.length))
      let desired = usedPanels.map((p) =>
        Math.max(actionSecondsByPanelId.get(p.id) ?? 0, baselineShare),
      )
      let total = desired.reduce((a, b) => a + b, 0)
      if (total > MAX_DURATION_SEC) {
        const scale = MAX_DURATION_SEC / total
        desired = desired.map((s) => Math.max(MIN_PER_SHOT_SEC, Math.floor(s * scale)))
        total = desired.reduce((a, b) => a + b, 0)
      }
      perShotDurations = desired
      duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, total))
      durationSource = 'baseline'
    }
  }

  // ── PROMPT ASSEMBLY ──
  let promptCore: string
  let dialogueBeatCount: number
  if (params.rawPrompt && params.rawPrompt.trim().length > 0) {
    // User-edited rawPrompt wins; ships verbatim. The Group Card's
    // textarea is the source of truth for the user's review ("what I see
    // is what runs"). We still PREPEND the r2v ref-map and APPEND a
    // per-shot timing guide: without the ref-map a hand-written "@Vera"
    // is a bare token the model can't bind to a reference image; without
    // the timing guide a hand-written multi-action shot gets starved.
    const raw = params.rawPrompt.trim()
    dialogueBeatCount = (raw.match(/對白：|说「|: "/g) || []).length
    const refMap = mode === 'r2v' ? buildR2vRefMapSection(r2vRefOrder) : ''
    const timingGuide = buildPerShotDurationGuide(perShotDurations)
    const scaffolded = composeRawPromptScaffold(raw, refMap, timingGuide)
    // 2026-06-03 — the raw branch previously shipped NO audio directive, so
    // the primary R2V narrative-edit flow re-exposed both the AtlasCloud
    // audio-moderation false-positive and the "低頻貝斯 → fake hum" incident.
    // Append it here too (gated on the raw-derived dialogue count + sound).
    promptCore = [scaffolded, buildAudioDirective(dialogueBeatCount, sound)].join('\n\n')
  } else {
    const built = buildAtlasCloudPrompt(
      usedPanels,
      mode,
      characterRefs,
      sceneRefs,
      propRefs,
      projectData,
      r2vRefOrder,
      perShotDurations,
      sound,
    )
    promptCore = built.prompt
    dialogueBeatCount = built.dialogueBeatCount
  }

  // Wrap: styleAnchor + lighting → core → visualModifiers → style
  // negative (visual-style suppressors) → clean-frame positive
  // directive. The clean-frame directive replaces the previous
  // "AVOID: 字幕,..." inline negative which caused the model to
  // sometimes paint the words 字幕 / 文字 / watermark into the frame
  // (the AVOID list itself rendered as on-screen text — a classic
  // pink-elephant failure for video models). Positive phrasing keeps
  // the artifact suppressed without ever naming it.
  const styleNegativeFragment = styleNegative
    ? `視覺風格負面詞(避免出現以下風格傾向): ${styleNegative}.`
    : ''
  const prompt = [
    stylePrefix,
    promptCore,
    styleSuffix,
    styleNegativeFragment,
    UNIVERSAL_ATLASCLOUD_CLEAN_FRAME_DIRECTIVE,
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')

  const estimatedTokens = estimatePromptTokens(prompt)
  if (estimatedTokens > PROMPT_TOKEN_WARN_THRESHOLD) {
    // Observable root-cause for "rich description, tail shot swallowed":
    // past this band Seedance starts dropping late-shot narrative and
    // ignoring the audio directive. We don't truncate user content — we
    // surface it so an over-rich group is diagnosable from logs.
    logger.warn({
      message: 'AtlasCloud composite prompt exceeds token warn threshold',
      details: {
        storyboardId: validPanels[0].storyboardId,
        mode,
        estimatedTokens,
        threshold: PROMPT_TOKEN_WARN_THRESHOLD,
        promptLength: prompt.length,
        panelsUsed: usedPanels.length,
        characterRefs: characterRefs.length,
        sceneRefs: sceneRefs.length,
        propRefs: propRefs.length,
        hint: 'tail-shot narrative / audio directive may be dropped; reduce inline anchors or split the group',
      },
    })
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
      durationSource,
      perShotDurations,
      actionFlooredPanels: actionSecondsByPanelId.size,
      aspectRatio,
      generateAudio: sound,
      dialogueBeatCount,
      promptLength: prompt.length,
      visualStyleId: resolvedStyle?.style.id ?? null,
      negativeLength: styleNegative.length,
      cleanFrameDirective: true,
      estimatedTokens,
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
      ...(params.resolution ? { resolution: params.resolution } : {}),
      // Phase S — forward per-group motion/camera reference video to
      // AtlasCloud's reference_videos[] (max 3, we send the 1 we have).
      // Skipped when user hasn't uploaded one or when the mode is t2v
      // (text-only models ignore reference inputs anyway, but pass-through
      // keeps the contract uniform; generator gates on r2v mode).
      ...(groupReferenceVideoUrl ? { referenceVideos: [groupReferenceVideoUrl] } : {}),
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
