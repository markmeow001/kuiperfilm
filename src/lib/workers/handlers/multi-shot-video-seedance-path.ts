/**
 * Seedance "composite" path for multi-shot video.
 *
 * Semantically different from Kling multi-shot:
 *   - Kling B path: t2v + multi_shot=intelligence → N consecutive clips
 *     stitched into one ~25s narrative video.
 *   - Kling C path: i2v per panel → N chunks stitched into one video.
 *   - Seedance composite (here): a SINGLE 4-15s creative video built
 *     from up to 9 reference images delivered via BobAPI's `content[]`
 *     scheme (`@N` markers in the prompt let the model know which
 *     reference corresponds to which beat).
 *
 * Reference image priority (9-image BobAPI cap):
 *   1. Character appearance images — same dedup + appearance resolution
 *      as the b-path's SubjectInfos pipeline (panel.characters + srt
 *      speakers + description mining). Cap at 4 so dialogues with 3+
 *      speakers + a scene still fit.
 *   2. Location reference images — one image per unique location used
 *      by the panel group, picked by view name match.
 *   3. Panel images — when available, the FIRST panel image becomes
 *      BobAPI's `first_frame` (locks the opening composition); any
 *      remaining panel images fill leftover slots as references.
 *
 * Pure t2v mode (no panel imageUrls, but ≥1 character or scene ref):
 *   BobAPI Seedance 2.0 supports first_frame-less generation. When the
 *   group's panels have no images yet (project mid-pipeline) but the
 *   character + scene catalog is populated, we still ship — the model
 *   uses the character/scene reference images for identity anchoring
 *   and synthesises the composition from the script prompt.
 *
 * Provider scope: only `taijiai::seedance-2.0-720p` today. fal Seedance
 * variants have a flat i2v API (image_url + optional end_image_url),
 * not the 9-ref content[] composite endpoint, so they intentionally
 * stay multiShot=false in the variant registry — the picker greys out
 * 多鏡頭 when user lands on fal Seedance.
 *
 * Output mapping: ONE video → stored as the storyboard's
 * `multiShotVideoUrl` + single-element `multiShotClipUrls`. The
 * existing UI reads from these via `getMultiShotClipUrls()` and
 * renders the composite at the group level.
 */

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { TaijiaiSeedanceVideoGenerator } from '@/lib/generators/video/taijiai'
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
import {
  findCharacterByName,
  parsePanelCharacterReferences,
  parseImageUrls,
  resolveNovelData,
} from './image-task-handler-shared'
import {
  extractSpokenLineFromSrtSegment,
  looksLikeStageDirection,
} from './multi-shot-video-b-path'

/** BobAPI multi-ref cap: 9 images per the wiki Section 4.2. */
const MAX_REFERENCE_IMAGES = 9
/** Soft cap on character refs so dialogue groups (3+ speakers) still
 * leave room for scene + panel references. */
const MAX_CHARACTER_REFS = 4
/** Soft cap on scene refs. Most groups stay in 1 location; 2 covers the
 * "interior→exterior cut within one group" case. */
const MAX_SCENE_REFS = 2
/** Seedance 2.0 duration range per the wiki (also clamped by generator). */
const MIN_DURATION_SEC = 4
const MAX_DURATION_SEC = 15

interface PanelLite {
  id: string
  imageUrl: string | null
  description: string | null
  videoPrompt: string | null
  characters: string | null
  location: string | null
  /** SRT-style dialogue blob — same field the b-path uses. Format is
   *  "<NAME>说「<line>」" / "<NAME>: <line>" / bare quoted span / stage
   *  direction. Parsed via extractSpokenLineFromSrtSegment. */
  srtSegment: string | null
  storyboardId: string
}

/** Resolved character reference for the Seedance content[] payload. */
interface CharacterRef {
  id: string
  name: string
  imageUrl: string
}

/** Resolved scene reference for the Seedance content[] payload. */
interface SceneRef {
  id: string
  name: string
  imageUrl: string
}

/**
 * True when this videoModel routes to Seedance composite (BobAPI @N
 * multi-ref). Used by the dispatcher in multi-shot-video-handler.ts.
 * Fails closed for everything else.
 */
export function shouldUseSeedanceComposite(videoModel: string): boolean {
  const parsed = parseModelKeyStrict(videoModel)
  if (!parsed) return false
  // Only the BobAPI/taijiai Seedance variant carries the content[] @N
  // composite API surface. fal Seedance has a different flat API and
  // is handled (today) only on the single-shot per-panel path.
  return parsed.provider === 'taijiai' && /^seedance-2\.0/.test(parsed.modelId)
}

type NovelData = Awaited<ReturnType<typeof resolveNovelData>>

/**
 * Walk panels and collect unique character references with their
 * appearance imageUrl. Mirrors the first pass of b-path's SubjectInfos
 * pipeline. Falls back to appearances[0] when no episode binding / panel
 * appearance hint is available — same priority as b-path.
 */
function collectCharacterRefs(
  panels: PanelLite[],
  projectData: NovelData,
  episodeBindings: Map<string, string>,
): CharacterRef[] {
  const refs: CharacterRef[] = []
  const seenIds = new Set<string>()
  for (const panel of panels) {
    if (refs.length >= MAX_CHARACTER_REFS) break
    const charRefs = parsePanelCharacterReferences(panel.characters)
    for (const ref of charRefs) {
      if (refs.length >= MAX_CHARACTER_REFS) break
      const character = findCharacterByName(projectData.characters || [], ref.name)
      if (!character) continue
      if (seenIds.has(character.id)) continue
      const appearances = character.appearances || []
      let appearance = appearances[0]
      const boundAppearanceId = episodeBindings.get(character.id)
      if (ref.appearance) {
        const matched = appearances.find(
          (a) => (a.changeReason || '').toLowerCase() === ref.appearance!.toLowerCase(),
        )
        if (matched) appearance = matched
        else if (boundAppearanceId) {
          const bound = appearances.find((a) => a.id === boundAppearanceId)
          if (bound) appearance = bound
        }
      } else if (boundAppearanceId) {
        const bound = appearances.find((a) => a.id === boundAppearanceId)
        if (bound) appearance = bound
      }
      if (!appearance) continue
      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue
      seenIds.add(character.id)
      refs.push({ id: character.id, name: ref.name, imageUrl: publicUrl })
    }
  }
  // Description-mining fallback (b-path Pass 3 equivalent): for groups
  // where panel.characters is empty but the description names a project
  // character, pull them in so identity still anchors. Caps at the same
  // MAX_CHARACTER_REFS budget so dialogue groups don't displace scenes.
  for (const panel of panels) {
    if (refs.length >= MAX_CHARACTER_REFS) break
    const desc = `${panel.description ?? ''}\n${panel.videoPrompt ?? ''}`.trim()
    if (!desc) continue
    for (const character of projectData.characters ?? []) {
      if (refs.length >= MAX_CHARACTER_REFS) break
      if (seenIds.has(character.id)) continue
      const aliases = character.name.split('/').map((s) => s.trim()).filter(Boolean)
      const hit = aliases.some((alias) => alias && desc.includes(alias))
      if (!hit) continue
      const appearances = character.appearances || []
      let appearance = appearances[0]
      const boundAppearanceId = episodeBindings.get(character.id)
      if (boundAppearanceId) {
        const bound = appearances.find((a) => a.id === boundAppearanceId)
        if (bound) appearance = bound
      }
      if (!appearance) continue
      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue
      seenIds.add(character.id)
      refs.push({ id: character.id, name: character.name, imageUrl: publicUrl })
    }
  }
  return refs
}

/**
 * Collect unique location reference images from the panel group's
 * `panel.location` strings. Mirrors b-path: location string is either
 * "<name>" or "<name>#<viewHint>"; viewHint picks a specific image
 * inside the location's images[].
 *
 * Widened to LocationRow so we can index `id` + `viewName` — the shared
 * NovelData.LocationLike type is intentionally narrow (image handlers
 * don't need those), but the Prisma include carries them at runtime.
 */
interface LocationImageRow {
  id?: string
  imageIndex?: number
  isSelected?: boolean
  imageUrl?: string | null
  viewName?: string | null
}
interface LocationRow {
  id: string
  name: string
  images?: LocationImageRow[]
}

function collectSceneRefs(
  panels: PanelLite[],
  projectData: NovelData,
  locOverrideById: Map<string, string>,
): SceneRef[] {
  const refs: SceneRef[] = []
  const seenIds = new Set<string>()
  const locations = (projectData.locations as unknown as LocationRow[] | undefined) ?? []
  if (locations.length === 0) return refs
  for (const panel of panels) {
    if (refs.length >= MAX_SCENE_REFS) break
    if (!panel.location) continue
    const hashIdx = panel.location.indexOf('#')
    const locName = (hashIdx === -1 ? panel.location : panel.location.slice(0, hashIdx)).trim()
    if (!locName) continue
    const loc = locations.find((l) => l.name.toLowerCase() === locName.toLowerCase())
    if (!loc) continue
    if (seenIds.has(loc.id)) continue
    const panelViewHint = hashIdx === -1 ? null : panel.location.slice(hashIdx + 1).trim()
    const overrideViewName = locOverrideById.get(loc.id)
    const effectiveView = (overrideViewName ?? panelViewHint) || null
    const images = loc.images ?? []
    const viewMatch = effectiveView
      ? images.find((img) => (img.viewName || '').trim().toLowerCase() === effectiveView.toLowerCase())
      : null
    const selected = images.find((img) => img.isSelected === true)
    const primary = images.find((img) => (img.imageIndex ?? 0) === 0) ?? images[0]
    const pickedImg = viewMatch || selected || primary
    const pickedRaw = pickedImg?.imageUrl
    const publicUrl = toSignedUrlIfCos(pickedRaw, 7200)
    if (!publicUrl) continue
    seenIds.add(loc.id)
    refs.push({ id: loc.id, name: loc.name, imageUrl: publicUrl })
  }
  return refs
}

/**
 * Detect dialogue presence in a free-form rawPrompt so we know whether
 * to append the TTS audio directive or the silent ambient directive.
 *
 * Heuristics (any match → has dialogue):
 *   - "<NAME>说「..." / "<NAME>: ..." / quoted span containing 中文 / 字母
 *   - "对白：..." / "[Cast: ...]"  prefixes
 *   - "Voiceover (off-camera)" / "OS:" off-screen narration markers
 */
function countDialogueBeatsInRawPrompt(raw: string): number {
  let count = 0
  // Speaker: "line" or 「line」 — both Western and CJK quotes.
  const quoted = raw.match(/[「"“”'']([^「」"“”'']{2,})[」"”“'']/g)
  if (quoted) count += quoted.length
  // SPEAKER: line (colon style)
  const tagged = raw.match(/[一-鿿A-Za-z][一-鿿A-Za-z\d_]{0,20}\s*[:：]\s*["「'']/g)
  if (tagged) count += Math.max(0, tagged.length - count) // avoid double-count
  // "Voiceover (off-camera)" / "OS:" markers
  if (/voiceover|VO[:：]|off-camera|OS[:：]/i.test(raw)) count += 1
  return count
}

/**
 * Wrap a user-supplied rawPrompt with the same audio directive footer
 * buildSeedancePrompt() emits. The rawPrompt body stays verbatim so the
 * UI's "what you see is what runs" contract holds.
 */
function wrapRawPromptWithAudioDirective(
  rawPrompt: string,
): { prompt: string; dialogueBeatCount: number } {
  const dialogueBeatCount = countDialogueBeatsInRawPrompt(rawPrompt)
  const footer = dialogueBeatCount > 0
    ? '音频：原生输出双声道音频，按上述对白逐字配音（语气、停顿、情绪与角色一致），'
      + '唇形与配音严格同步；背景叠加场景对应的环境音（脚步、风声、室内回响等），'
      + '避免任何机械合成感或字幕音。'
    : '音频：输出场景对应的环境音（脚步、风声、室内回响等），'
      + '本组无角色对白，请勿合成任何说话声。'
  return {
    prompt: `${rawPrompt}\n\n${footer}`,
    dialogueBeatCount,
  }
}

/**
 * Build the Seedance prompt with @N markers + structured dialogue.
 *
 * Seedance 2.0 supports native multi-channel audio output including
 * spoken dialogue (TTS) and ambient SFX. To unlock the TTS layer the
 * prompt MUST inline dialogue in `<speaker>说「<line>」` form with
 * tone + lip-sync hints — pure visual descriptions produce silent
 * output (which is what shipped before this fix).
 *
 * Structure (混合 ByteDance recommended pattern):
 *   1. Reference anchor list — @N character / scene markers
 *   2. Per-beat narrative line — visual description
 *   3. Per-beat dialogue line  — `<speaker>说「<line>」(语气自然，
 *      唇形与对白同步)` when panel.srtSegment has spoken content
 *   4. Closing directive — first_frame anchor OR t2v free-composition
 *      hint, plus a global audio directive ("native dialogue + ambient
 *      SFX, 自然唇形同步")
 */
function buildSeedancePrompt(
  panels: PanelLite[],
  characterRefs: CharacterRef[],
  sceneRefs: SceneRef[],
  panelHasFirstFrame: boolean,
): { prompt: string; dialogueBeatCount: number } {
  const sections: string[] = []
  let refIdx = 0
  if (characterRefs.length > 0) {
    const charLines = characterRefs.map((c) => {
      refIdx += 1
      return `@${refIdx} = ${c.name}`
    })
    sections.push(`角色一致性参考（identity anchors）:\n${charLines.join('；')}`)
  }
  if (sceneRefs.length > 0) {
    const sceneLines = sceneRefs.map((s) => {
      refIdx += 1
      return `@${refIdx} = 场景「${s.name}」`
    })
    sections.push(`场景一致性参考（scene anchors）:\n${sceneLines.join('；')}`)
  }

  // Default speaker fallback when srtSegment doesn't tag a name: the
  // first character ref (typically the panel's primary subject). Empty
  // when no characters resolved — bareQuoted dialogue ships with
  // "[配音]说「...」" so Seedance still TTS's it.
  const fallbackSpeaker = characterRefs[0]?.name ?? '配音'

  // Per-beat: visual description + (optional) dialogue line. Cap each
  // narrative segment at 200 chars so a 6-panel group doesn't blow past
  // Seedance's prompt budget. Dialogue lines aren't capped because TTS
  // accuracy depends on the line being verbatim.
  let dialogueBeatCount = 0
  const beats = panels.map((p, i) => {
    const visualRaw = (p.videoPrompt || p.description || `分鏡 ${i + 1}`).trim()
    const visual = visualRaw.length > 200 ? `${visualRaw.slice(0, 200)}…` : visualRaw
    const lines: string[] = [`${i + 1}. ${visual}`]

    const srt = (p.srtSegment ?? '').trim()
    if (srt && !looksLikeStageDirection(srt)) {
      const spoken = extractSpokenLineFromSrtSegment(srt, fallbackSpeaker)
      if (spoken && spoken.content) {
        // Use the b-path's parsed shape so speaker overrides (panel
        // hint > fallback) stay consistent across both workers. Always
        // append the lip-sync directive — Seedance's TTS quality drops
        // hard when the prompt doesn't explicitly ask for sync.
        lines.push(
          `   对白：${spoken.speaker}说「${spoken.content}」` +
            `（语气自然，音量适中，唇形与对白严格同步，嘴部动作细腻不夸张）`,
        )
        dialogueBeatCount += 1
      }
    }
    return lines.join('\n')
  })
  sections.push(
    `按以下顺序展现连续分镜情境（每段约 1-3 秒衔接过渡）：\n${beats.join('；\n')}`,
  )

  // Closing directive — different copy when we have a first_frame vs
  // pure t2v so the model knows whether to honor the opening composition
  // or compose freely from the references.
  if (panelHasFirstFrame) {
    sections.push(
      `首帧已锁定为分镜 1 的画面；后续运动从该构图自然延展，` +
        `保持角色身份和场景一致性，避免硬切。`,
    )
  } else {
    sections.push(
      `根据上述参考图合成连贯的多鏡頭視頻：` +
        `角色外观与服饰严格匹配角色参考（@1..@${characterRefs.length}），` +
        `场景背景与材质参考场景图，` +
        `镜头运动自然顺畅，避免硬切。`,
    )
  }

  // Global audio directive — tells the model to produce real spoken
  // audio (TTS) + ambient SFX, not the silent visual default. Only
  // attached when at least one beat carries dialogue, otherwise we
  // keep the audio track ambient-only to avoid fake mumbling.
  if (dialogueBeatCount > 0) {
    sections.push(
      `音频：原生输出双声道音频，按上述对白逐字配音（` +
        `语气、停顿、情绪与角色一致），唇形与配音严格同步；` +
        `背景叠加场景对应的环境音（脚步、风声、室内回响等），` +
        `避免任何机械合成感或字幕音。`,
    )
  } else {
    sections.push(
      `音频：输出场景对应的环境音（脚步、风声、室内回响等），` +
        `本组无角色对白，请勿合成任何说话声。`,
    )
  }

  return { prompt: sections.join('\n\n'), dialogueBeatCount }
}

/**
 * Decide how to allocate the 9-image budget across character / scene /
 * panel references. Returns the URLs in the exact order they'll appear
 * in BobAPI's content[] so prompt @N markers stay aligned.
 */
function planReferenceBudget(args: {
  panels: PanelLite[]
  characterRefs: CharacterRef[]
  sceneRefs: SceneRef[]
}): {
  firstFrameUrl: string | undefined
  referenceUrls: string[]
} {
  const { panels, characterRefs, sceneRefs } = args
  const panelImageUrls = panels
    .map((p) => p.imageUrl)
    .filter((u): u is string => !!u && u.trim().length > 0)

  // First-frame anchor: prefer the first panel's image when available.
  // The first_frame slot lives outside the `referenceImages` array on
  // the generator side, so it doesn't consume a slot in our local
  // accounting below.
  const firstFrameUrl = panelImageUrls[0]
  const remainingPanelUrls = firstFrameUrl ? panelImageUrls.slice(1) : []

  // 9-image total cap minus 1 slot for first_frame (if present) leaves
  // 8 reference slots. Without first_frame all 9 are available for refs.
  const refSlotsAvailable = firstFrameUrl ? MAX_REFERENCE_IMAGES - 1 : MAX_REFERENCE_IMAGES

  const orderedRefs: string[] = []
  const seen = new Set<string>()
  const push = (url: string | undefined) => {
    if (!url) return false
    if (seen.has(url)) return false
    if (orderedRefs.length >= refSlotsAvailable) return false
    seen.add(url)
    orderedRefs.push(url)
    return true
  }
  // Mark the first_frame url as seen so we don't re-push the same image
  // (panels with overlapping URLs would otherwise count twice toward
  // the 9-image budget but waste a slot).
  if (firstFrameUrl) seen.add(firstFrameUrl)

  for (const c of characterRefs) push(c.imageUrl)
  for (const s of sceneRefs) push(s.imageUrl)
  for (const url of remainingPanelUrls) push(url)

  return { firstFrameUrl, referenceUrls: orderedRefs }
}

/**
 * Run the Seedance composite for a panel group. Caller (multi-shot-
 * video-handler) is responsible for loading + validating panels.
 *
 * Behaviour:
 *   - Resolves project's character + location catalog so identity
 *     anchors can be passed even when panel images aren't ready yet
 *     (pure t2v mode).
 *   - Allocates the 9-image budget: characters → scenes → panel images
 *     (first panel image as first_frame when present).
 *   - Duration scales with reference image count (4s + 1.5s per ref,
 *     capped at 15s).
 *   - Output URL is uploaded to our COS so we don't depend on
 *     BobAPI's video_url longevity (it 302-redirects through their
 *     OSS which we mirror locally via downloadHeaders).
 *   - Persisted as `multiShotVideoUrl` + single-element
 *     `multiShotClipUrls` on the storyboard row.
 */
export async function runMultiShotSeedanceComposite(params: {
  job: Job<TaskJobData>
  projectId: string
  validPanels: PanelLite[]
  videoModel: string
  // sound / aspectRatio mirror the handler's payload shape — both can be
  // undefined when the API caller omits them. We default in-handler so
  // the BobAPI call always receives a concrete value (audio defaults on,
  // ratio defaults to the project's natural ratio if known, else 16:9).
  sound: boolean | undefined
  aspectRatio: string | undefined
  /** Per-call character appearance overrides (UI swap-costume affordance). */
  characterOverrides?: Array<{ characterId: string; appearanceId?: string }>
  /** Per-call location view overrides. */
  locationOverrides?: Array<{ locationId: string; viewName?: string }>
  /** User-edited / LLM-enriched narrative prompt from the GroupCard
   *  textbox. When present, it carries dialogue inline as
   *  `<speaker>: "<line>"` / `镜头N (X-Y seconds)·...` and uses Kling-
   *  style structured shot breakdowns. We send it verbatim to BobAPI
   *  (only suffixing the audio directive) so what the user reviews in
   *  the UI is what ships. */
  rawPrompt?: string
  /** Per-panel duration seconds (sum = total video duration). Lets the
   *  caller override Seedance's panel-count heuristic when the prompt
   *  was built around specific shot lengths. Clamped to 4-15s total. */
  panelDurations?: number[]
}): Promise<{
  storyboardId: string
  multiShotVideoUrl: string
  multiShotClipUrls: string[]
  chunkCount: number
  shotCount: number
  subjectCount: number
  path: 'seedance-composite'
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
  const logger = createScopedLogger({
    module: 'worker.multi-shot-seedance',
    action: 'multi_shot_seedance_composite',
  })

  if (validPanels.length === 0) {
    throw new Error('SEEDANCE_COMPOSITE_NO_PANELS')
  }

  await reportTaskProgress(job, 12, { stage: 'seedance_composite_collect_refs' })

  // Per-call override maps — mirrors b-path's shape so the caller can
  // pass the same raw arrays through both dispatches.
  const charOverrideById = new Map<string, string>()
  for (const o of params.characterOverrides ?? []) {
    if (o.characterId && o.appearanceId) charOverrideById.set(o.characterId, o.appearanceId)
  }
  const locOverrideById = new Map<string, string>()
  for (const o of params.locationOverrides ?? []) {
    if (o.locationId && o.viewName) locOverrideById.set(o.locationId, o.viewName)
  }

  // Episode-level appearance bindings (same shape as b-path lines 1240+).
  // All panels in a group live under one storyboard → one episode.
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
  // Per-call override beats episode binding — match the b-path priority
  // so the resolvedAppearance is consistent between dispatches.
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

  // Fail closed when we have absolutely no anchors — pure prompt-only
  // mode gives the model nothing to anchor identity to and BobAPI tends
  // to reject it on moderation grounds anyway.
  if (!firstFrameUrl && referenceUrls.length === 0) {
    throw new Error('SEEDANCE_COMPOSITE_NO_REFERENCES')
  }

  // Prompt source priority:
  //   1. User-edited rawPrompt from the GroupCard textbox — already
  //      contains dialogue inline + shot timing markers; ships verbatim
  //      with the audio directive appended.
  //   2. buildSeedancePrompt() — assemble from panels + char/scene refs.
  //
  // Both append the same global audio directive so TTS activates when
  // dialogue is present.
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

  // Duration priority:
  //   1. sum(panelDurations) when caller supplied per-shot timings
  //      (UI's "對白驅動每鏡時長" mode). Clamped to BobAPI 4-15s range.
  //   2. Panel-count × 2s baseline (5 panels → 10s), clamped 4-15s.
  //      Old formula `4 + ceil(refCount * 1.5)` under-counted for groups
  //      with 1 ref + 5 panels (gave 6s for a 5-shot story).
  let duration: number
  if (params.panelDurations && params.panelDurations.length > 0) {
    const sum = params.panelDurations.reduce((s, d) => s + (Number.isFinite(d) ? d : 0), 0)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, Math.round(sum)))
  } else {
    const baseline = Math.round(usedPanels.length * 2)
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, baseline))
  }

  logger.info({
    message: 'Seedance composite submit',
    details: {
      storyboardId: validPanels[0].storyboardId,
      panelsRequested: validPanels.length,
      panelsUsed: usedPanels.length,
      characterRefs: characterRefs.length,
      sceneRefs: sceneRefs.length,
      hasFirstFrame: Boolean(firstFrameUrl),
      referenceUrlCount: referenceUrls.length,
      duration,
      aspectRatio,
      // generateAudio MUST stay true when dialogueBeatCount > 0 — the
      // audio directive in the prompt only works if the request body
      // also sets generate_audio: true (BobAPI gate). When no dialogue
      // is present we still pass sound through (defaults true) so SFX
      // ships either way; the directive switches to "ambient only".
      generateAudio: sound,
      dialogueBeatCount,
      promptLength: prompt.length,
      mode: firstFrameUrl ? 'i2v+refs' : 't2v+refs',
    },
  })

  await assertTaskActive(job, 'seedance_composite_submit')
  await reportTaskProgress(job, 20, { stage: 'seedance_composite_submit' })

  const generator = new TaijiaiSeedanceVideoGenerator()
  const generateResult = await generator.generate({
    userId,
    // BaseVideoGenerator types imageUrl as a required string but the
    // taijiai generator's `if (imageUrl)` truthy gate treats '' as "no
    // first_frame" → pure t2v with content[] references. Send '' rather
    // than coercing the base interface optional, so we don't perturb the
    // Kling i2v generators that DO require it.
    imageUrl: firstFrameUrl ?? '',
    prompt,
    options: {
      modelId: 'seedance-2.0-720p',
      duration,
      aspectRatio,
      generateAudio: sound,
      referenceImages: referenceUrls,
    },
  })

  if (!generateResult.success || !generateResult.externalId) {
    throw new Error(
      `SEEDANCE_COMPOSITE_SUBMIT_FAILED: ${generateResult.error ?? 'unknown'}`,
    )
  }

  await reportTaskProgress(job, 40, { stage: 'seedance_composite_poll' })

  const polled = await waitExternalResult(job, generateResult.externalId, userId, {
    // Seedance 2.0 with heavy prompts (3000+ chars + 4 dialogue beats +
    // 10s duration) has been observed to run 12+ minutes when BobAPI is
    // under load. 10 min was too tight; 15 min gives heavy runs headroom
    // without blocking the queue indefinitely. Worker keeps reporting
    // progress in the 40-90 range automatically via waitExternalResult's
    // linear interp.
    timeoutMs: 15 * 60 * 1000,
    progressStart: 40,
    progressEnd: 90,
  })

  if (!polled.url) {
    throw new Error('SEEDANCE_COMPOSITE_NO_RESULT_URL')
  }

  await reportTaskProgress(job, 92, { stage: 'seedance_composite_persist' })

  // BobAPI video_url 302-redirects through vshare OSS with an
  // Authorization: Bearer requirement (see async-poll pollTaijiaiTask
  // and project_kuiperfilm_taijiai_seedance_blocked memory).
  // uploadVideoSourceToCos accepts downloadHeaders so the redirect
  // chain completes correctly.
  const targetId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(
    polled.url,
    `multi-shot-seedance/${targetId}`,
    targetId,
    polled.downloadHeaders,
  )

  await prisma.novelPromotionStoryboard.update({
    where: { id: targetId },
    data: buildMultiShotClipUpdate([cosKey]),
  })

  await reportTaskProgress(job, 98, { stage: 'seedance_composite_done' })

  logger.info({
    message: 'Seedance composite persisted',
    details: {
      storyboardId: targetId,
      cosKey,
      panelsUsed: usedPanels.length,
      characterRefs: characterRefs.length,
      sceneRefs: sceneRefs.length,
    },
  })

  // Fat result mirrors the b-path shape so MultiShotBindingsRail (which
  // reads from task.result.multiShotClipUrls / multiShotVideoUrl) can
  // render the video player without a frontend code change. Bindings
  // section lets the chip rail show which character / scene reference
  // was actually used in the call.
  return {
    storyboardId: targetId,
    multiShotVideoUrl: cosKey,
    multiShotClipUrls: [cosKey],
    chunkCount: 1,
    shotCount: usedPanels.length,
    subjectCount: characterRefs.length + sceneRefs.length,
    path: 'seedance-composite',
    mode: firstFrameUrl ? 'i2v+refs' : 't2v+refs',
    bindings: {
      characters: characterRefs.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      scenes: sceneRefs.map((s) => ({ id: s.id, name: s.name, imageUrl: s.imageUrl })),
    },
  }
}
