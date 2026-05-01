import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { createScopedLogger } from '@/lib/logging/core'
import { generateVideo } from '@/lib/generator-api'
import {
  parsePanelCharacterReferences,
  findCharacterByName,
  parseImageUrls,
} from './image-task-handler-shared'

interface CharacterAppearanceForBPath {
  id: string
  changeReason: string | null
  imageUrls: string | null
  imageUrl: string | null
  selectedIndex: number | null
}

interface CharacterForBPath {
  id: string
  name: string
  appearances?: CharacterAppearanceForBPath[]
}
import {
  assertTaskActive,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
  waitExternalResult,
} from '../utils'
import { reportTaskProgress } from '../shared'

interface BPathPanel {
  id: string
  description: string | null
  videoPrompt: string | null
  characters: string | null
  /**
   * Free-form scene name written by the analyze worker — typically
   * `<locationName>` or `<locationName>#<viewHint>` (Approach B-Standard).
   * We use the bare name to look up Location entities for SubjectInfos.
   */
  location: string | null
  /** "平视中景" / "仰拍特写" / "越肩近景" — passed straight to the prompt. */
  shotType: string | null
  /** "缓缓推近" / "手持跟随" / "猛然拉远" — appended after the visual body. */
  cameraMove: string | null
  imageUrl: string | null
  storyboardId: string
}

interface LocationImageForBPath {
  imageIndex?: number | null
  imageUrl?: string | null
  isSelected?: boolean | null
  viewName?: string | null
}

interface LocationForBPath {
  id: string
  name: string
  images?: LocationImageForBPath[]
}

interface BPathProjectData {
  characters?: CharacterForBPath[]
  locations?: LocationForBPath[]
}

interface BPathDialogueLine {
  speaker: string
  content: string
}

/** Per-shot entry that maps to Kling 3-Omni's customize-mode multi_prompt. */
export interface BPathShotPromptEntry {
  index: number
  prompt: string
  duration: number
}

/** Maximum total Duration accepted by Kling 3 / 3-Omni (std/pro). */
export const KLING_OMNI_MAX_TOTAL_DURATION = 15
/** Default per-shot allocation when caller does not specify durations. */
export const KLING_OMNI_DEFAULT_PER_SHOT_DURATION = 3
/** Tencent doc constraint: customize-mode multi_prompt allows at most 6 shots. */
export const KLING_OMNI_MAX_SHOTS = 6

/**
 * Build a per-panel shot fragment (no `镜头N:` prefix) that mixes the
 * visual + motion prompt with any matched dialogue. Used by both modes:
 * intelligence concatenates the fragments under `镜头N:`, customize
 * embeds them as discrete multi_prompt entries.
 *
 * Priority: description over videoPrompt. The script_to_storyboard
 * worker writes description with the original character names
 * (e.g. "劉浩重重倒在水洼中，陳子豪站在前方") and videoPrompt with
 * anonymised generic phrasing (e.g. "一名年轻男子重重倒在…另一名年轻男子站立")
 * so non-subject-aware image models can render shots without context.
 * Kling Omni's SubjectInfos.N pipeline ANCHORS subjects by name match
 * — feeding it the anonymised version causes identity confusion (e.g.
 * the wrong character falls in the puddle). Reproduced 2026-05-01:
 * uneven-duration regen of panels 1-5 had Chen Zihao falling instead
 * of Liu Hao because videoPrompt only said "另一名年轻男子".
 */
function buildShotBody(
  panel: Pick<BPathPanel, 'id' | 'description' | 'videoPrompt'>,
  dialogueByPanelId: ReadonlyMap<string, BPathDialogueLine[]>,
): string {
  const visual = (panel.description || panel.videoPrompt || '').trim()
  const dialogues = (dialogueByPanelId.get(panel.id) ?? [])
    .map((d) => `${d.speaker}说："${d.content}"`)
    .join(' ')
  return dialogues ? `${visual}\n${dialogues}`.trim() : visual
}

/**
 * Auto-assemble a Seedance-style 5-element prompt from existing panel
 * data — time-indexed segments, entity tags `[name]` matching
 * SubjectInfos.N, dialogue inline as `[speaker]: "line"`. Used by
 * intelligence mode by default so Kling's parser gets a structured
 * prompt that mirrors the format we manually validated produced the
 * cleanest action sequences.
 *
 * Time slices fall through `distributeShotDurations` → 3s/panel default,
 * capped at 15s total. Caller-supplied durations win when provided
 * (length must match panels).
 *
 * Format per shot:
 *   `<start>-<end> seconds: [scene] - [character1] [character2] body. (cameraMove). [speaker]: "dialogue"`
 *
 * Example:
 *   0-3 seconds: [废弃工业区_破晓] - [劉浩] 近景：劉浩眉頭緊鎖大吼出聲 (急速推近) [劉浩]: "操！"
 *
 * Notes:
 * - Scene tag uses the bare location name (strips `#viewHint`).
 * - Entity name brackets are 1:1 with SubjectInfos.N.Name so Kling can
 *   anchor visuals — same fix that resolved the wrong-character-falls
 *   bug on 2026-05-01.
 * - cameraMove is wrapped in parens to keep it grammatically
 *   self-contained when missing.
 * - Empty visual + no dialogue panels are dropped (consistent with
 *   buildBPathCombinedPrompt) and time slices recompute around them.
 */
export function buildSeedancePrompt(
  panels: Pick<BPathPanel, 'id' | 'description' | 'videoPrompt' | 'characters' | 'location' | 'shotType' | 'cameraMove'>[],
  dialogueByPanelId: ReadonlyMap<string, BPathDialogueLine[]>,
  requestedDurations?: number[],
): string {
  // Drop empty panels first so time accounting matches what makes it
  // into the output.
  const nonEmpty = panels.filter((p) => {
    const visual = (p.description || p.videoPrompt || '').trim()
    if (visual) return true
    return (dialogueByPanelId.get(p.id) ?? []).length > 0
  })
  if (nonEmpty.length === 0) return ''

  // Filter durations to non-empty panel positions if caller supplied
  // an array sized for the original panels list.
  let trimmedDurations: number[] | undefined
  if (requestedDurations && requestedDurations.length === panels.length) {
    trimmedDurations = []
    panels.forEach((p, idx) => {
      if (nonEmpty.includes(p)) trimmedDurations!.push(requestedDurations[idx])
    })
  } else if (requestedDurations) {
    trimmedDurations = requestedDurations
  }

  const { durations } = distributeShotDurations(nonEmpty.length, trimmedDurations)

  const lines: string[] = []
  let cursor = 0
  for (let i = 0; i < nonEmpty.length; i++) {
    const panel = nonEmpty[i]
    const start = cursor
    const end = cursor + durations[i]
    cursor = end

    const sceneRaw = (panel.location || '').trim()
    const sceneName = sceneRaw.includes('#') ? sceneRaw.split('#')[0].trim() : sceneRaw
    const sceneTag = sceneName ? `[${sceneName}]` : ''

    const charRefs = parsePanelCharacterReferences(panel.characters)
    const charTags = charRefs.map((r) => `[${r.name}]`).join(' ')

    const visual = (panel.description || panel.videoPrompt || '').trim()
    const camMove = (panel.cameraMove || '').trim()

    const dialogues = (dialogueByPanelId.get(panel.id) ?? [])
      .map((d) => `[${d.speaker}]: "${d.content}"`)
      .join(' ')

    const parts: string[] = [`${start}-${end} seconds:`]
    if (sceneTag) {
      parts.push(sceneTag)
      if (charTags) parts.push('-')
    }
    if (charTags) parts.push(charTags)
    if (visual) parts.push(visual)
    if (camMove) parts.push(`(${camMove})`)
    if (dialogues) parts.push(dialogues)

    lines.push(parts.join(' '))
  }
  return lines.join('\n\n')
}

/**
 * Build the combined `镜头N:` prompt that Kling Omni 3 ingests, including
 * matched dialogue lines so generate_audio:true dubs the script's actual
 * dialogue (otherwise the model invents talking sounds). Exposed for unit
 * tests; the runtime path calls it from runMultiShotBPath below.
 */
export function buildBPathCombinedPrompt(
  panels: Pick<BPathPanel, 'id' | 'description' | 'videoPrompt'>[],
  dialogueByPanelId: ReadonlyMap<string, BPathDialogueLine[]>,
): string {
  return panels
    .map((panel, i) => {
      const body = buildShotBody(panel, dialogueByPanelId)
      return `镜头${i + 1}: ${body}`
    })
    .filter((line) => line.trim().length > `镜头N: `.length)
    .join('\n\n')
}

/**
 * Distribute a total duration across N shots. When caller passes
 * `requestedDurations` we trust them after validating sum / range; when
 * undefined we hand out KLING_OMNI_DEFAULT_PER_SHOT_DURATION each, capped
 * at KLING_OMNI_MAX_TOTAL_DURATION (excess truncated from the tail).
 *
 * Returns `{ durations, totalDuration }` so the caller can drop both
 * into the Kling payload (Duration = totalDuration, multi_prompt[i].duration
 * = durations[i]).
 */
export function distributeShotDurations(
  shotCount: number,
  requestedDurations: number[] | undefined,
): { durations: number[]; totalDuration: number } {
  if (shotCount <= 0) {
    throw new Error('SHOT_COUNT_INVALID: at least one shot required')
  }
  if (shotCount > KLING_OMNI_MAX_SHOTS) {
    throw new Error(`SHOT_COUNT_TOO_MANY: ${shotCount} exceeds Kling Omni's ${KLING_OMNI_MAX_SHOTS}-shot cap`)
  }

  if (requestedDurations) {
    if (requestedDurations.length !== shotCount) {
      throw new Error(
        `PANEL_DURATIONS_LENGTH_MISMATCH: expected ${shotCount} durations, got ${requestedDurations.length}`,
      )
    }
    for (const d of requestedDurations) {
      if (!Number.isFinite(d) || d < 1) {
        throw new Error('PANEL_DURATION_INVALID: each duration must be a finite number ≥1 second')
      }
    }
    const total = requestedDurations.reduce((a, b) => a + b, 0)
    if (total > KLING_OMNI_MAX_TOTAL_DURATION) {
      throw new Error(
        `TOTAL_DURATION_EXCEEDS_LIMIT: ${total}s exceeds Kling Omni's ${KLING_OMNI_MAX_TOTAL_DURATION}s cap`,
      )
    }
    if (total < shotCount) {
      throw new Error('TOTAL_DURATION_BELOW_MIN: each shot needs at least 1s')
    }
    return { durations: requestedDurations.map((d) => Math.round(d)), totalDuration: total }
  }

  // Default: KLING_OMNI_DEFAULT_PER_SHOT_DURATION seconds per shot,
  // capped at the model's hard ceiling. With 5 shots × 3s = 15s; 6 shots
  // truncates the last second to stay within budget (we just take
  // floor(15/6) = 2s each plus distribute the remainder).
  const idealTotal = shotCount * KLING_OMNI_DEFAULT_PER_SHOT_DURATION
  const totalDuration = Math.min(idealTotal, KLING_OMNI_MAX_TOTAL_DURATION)
  const base = Math.floor(totalDuration / shotCount)
  const remainder = totalDuration - base * shotCount
  const durations = Array.from({ length: shotCount }, (_, i) => base + (i < remainder ? 1 : 0))
  return { durations, totalDuration }
}

/**
 * Customize-mode payload builder. Returns the multi_prompt array Kling
 * expects (ordered by shot index, 1-based). Filters out shots that have
 * neither visual nor dialogue content — same guard as the intelligence
 * builder — and re-numbers indices so the array stays compact (Kling
 * rejects gaps in `index`).
 */
export function buildBPathCustomizePrompts(
  panels: Pick<BPathPanel, 'id' | 'description' | 'videoPrompt'>[],
  dialogueByPanelId: ReadonlyMap<string, BPathDialogueLine[]>,
  durations: number[],
): BPathShotPromptEntry[] {
  if (panels.length !== durations.length) {
    throw new Error(
      `PANEL_DURATION_PAIRING_MISMATCH: ${panels.length} panels vs ${durations.length} durations`,
    )
  }
  const out: BPathShotPromptEntry[] = []
  panels.forEach((panel, i) => {
    const body = buildShotBody(panel, dialogueByPanelId)
    if (!body.trim()) return
    out.push({ index: out.length + 1, prompt: body, duration: durations[i] })
  })
  return out
}

/**
 * Tencent VOD Kling-Omni multi-shot path.
 *
 * Builds a single CreateAigcVideoTask with:
 *   - SubjectInfos.N for character consistency — first three speaking
 *     characters across the selected panels, each with their primary
 *     appearance image as the visual anchor.
 *   - One of two ExtInfo shapes:
 *     * **intelligence mode** (legacy default, total fixed 10s/5s):
 *       single combined Prompt ("镜头1: ... 镜头2: ...") with
 *       multi_shot=intelligence; Kling picks shot boundaries itself.
 *     * **customize mode** (new, total = sum of per-shot durations,
 *       up to 15s): multi_prompt array with explicit `{index, prompt,
 *       duration}` per shot; gives caller per-shot timing control.
 *       Falls into customize automatically if the caller supplies
 *       `panelDurations`, or requests `mode: 'customize'`.
 *
 * No imageUrl required on individual panels — this is text-to-video.
 */
export async function runMultiShotBPath(params: {
  job: Job<TaskJobData>
  validPanels: BPathPanel[]
  projectData: BPathProjectData
  videoModel: string
  sound?: boolean
  aspectRatio?: string
  /**
   * 'intelligence' (default) — model auto-decides shot boundaries.
   * 'customize' — every panel gets a fixed per-shot duration. Implicit
   * 'customize' when panelDurations is provided regardless of this flag.
   *
   * NB: payload.mode is already taken by the std/pro resolution selector
   * upstream — the multi-shot mode rides on its own field name.
   */
  multiShotMode?: 'intelligence' | 'customize'
  /**
   * Explicit per-shot durations matching panel order. Length must equal
   * panel count, each ≥1s, sum ≤15s. When omitted in customize mode,
   * defaults to KLING_OMNI_DEFAULT_PER_SHOT_DURATION per shot capped at
   * KLING_OMNI_MAX_TOTAL_DURATION.
   */
  panelDurations?: number[]
  /**
   * Caller-supplied final prompt that bypasses panel-based assembly.
   * Intended for hand-crafted Seedance-style 5-element prompts where
   * a single 15s segment internally describes 3-5 micro-shots with
   * time markers ("0-5 seconds: ... 5-10 seconds: ..."). Only honoured
   * in `intelligence` mode — customize mode requires per-shot prompts
   * via multi_prompt array, so rawPrompt is ignored there.
   *
   * Dialogue injection still happens — voiceLines matched to any of
   * the supplied panels are appended at the end as 「角色说: "对白"」
   * lines (so caller does not have to embed dialogue manually). If the
   * raw prompt already contains dialogue and you want to skip the
   * automatic append, omit the relevant panels from panelIds.
   */
  rawPrompt?: string
  /**
   * Intelligence-mode prompt assembly strategy. Ignored when rawPrompt
   * is provided (caller wins) or when multiShotMode is 'customize'.
   *
   * - 'auto-seedance' (DEFAULT, 2026-05-01): time-indexed
   *   `Xs-Ys: [scene] - [char] body (cameraMove). [speaker]: "line"`
   *   format. Designed to give Kling intelligence's parser the same
   *   shape as Seedance 2.0's manually validated 5-element method.
   * - 'panel-numbered': legacy `镜头1: ... 镜头2: ...` concatenation
   *   for callers that haven't migrated yet (kept bit-for-bit
   *   compatible with pre-Seedance behaviour).
   */
  promptStyle?: 'auto-seedance' | 'panel-numbered'
}): Promise<{ storyboardId: string; multiShotVideoUrl: string; shotCount: number; subjectCount: number; path: 'B'; multiShotMode: 'intelligence' | 'customize'; durations?: number[]; promptSource?: 'panels' | 'raw' | 'seedance' }> {
  const { job, validPanels, projectData, videoModel, sound, aspectRatio, panelDurations, rawPrompt } = params
  // Implicit promotion: caller passing panelDurations means they care
  // about per-shot timing; force customize regardless of the mode flag.
  const multiShotMode: 'intelligence' | 'customize' =
    panelDurations !== undefined ? 'customize' : (params.multiShotMode ?? 'intelligence')
  const { userId } = job.data
  const logger = createScopedLogger({
    module: 'worker.multi-shot-video-b-path',
    action: 'multi_shot_video_b_path_generate',
  })

  // Phase 11.4 / multi-appearance: pre-load EpisodeCharacter bindings
  // for the storyboard's episode so per-character costume overrides
  // apply to multi-shot generation too. All selected panels live under
  // the same storyboard, which lives under one episode.
  let episodeBindings = new Map<string, string>()
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

  // Collect unique characters in panel order, take their primary
  // appearance image for SubjectInfos. Cap at 3 (Tencent limit).
  const subjectMap = new Map<string, { name: string; imageUrl: string }>()
  for (const panel of validPanels) {
    const charRefs = parsePanelCharacterReferences(panel.characters)
    for (const ref of charRefs) {
      if (subjectMap.has(ref.name.toLowerCase())) continue
      const character = findCharacterByName(projectData.characters || [], ref.name)
      if (!character) continue
      const appearances = character.appearances || []
      let appearance = appearances[0]
      const boundAppearanceId = episodeBindings.get(character.id)
      if (boundAppearanceId) {
        const bound = appearances.find((a) => a.id === boundAppearanceId)
        if (bound) appearance = bound
      } else if (ref.appearance) {
        const matched = appearances.find(
          (a) => (a.changeReason || '').toLowerCase() === ref.appearance!.toLowerCase(),
        )
        if (matched) appearance = matched
      }
      if (!appearance) continue
      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue
      subjectMap.set(ref.name.toLowerCase(), { name: ref.name, imageUrl: publicUrl })
    }
  }
  // Tencent caps SubjectInfos at 3 entries per CreateAigcVideoTask. Take
  // characters first (typically 1-3 speaking roles drive the visual),
  // then fill remaining slots with location/scene reference images so
  // Kling has a consistent backdrop anchor across shots. Without scene
  // anchoring the same alleyway tends to drift in lighting/material
  // between cuts.
  const characterSubjects = Array.from(subjectMap.values()).map((s) => ({
    name: s.name,
    imageUrls: [s.imageUrl],
  }))

  const sceneSubjects: Array<{ name: string; imageUrls: string[] }> = []
  const remainingSlots = Math.max(0, 3 - characterSubjects.length)
  if (remainingSlots > 0 && (projectData.locations?.length ?? 0) > 0) {
    const seenLoc = new Set<string>()
    for (const panel of validPanels) {
      if (sceneSubjects.length >= remainingSlots) break
      if (!panel.location) continue
      // panel.location is "<name>" or "<name>#<viewHint>" (Approach
      // B-Standard). Match by name only — viewHint is for image picking
      // inside the location's images[] (handled below).
      const hashIdx = panel.location.indexOf('#')
      const locName = (hashIdx === -1 ? panel.location : panel.location.slice(0, hashIdx)).trim()
      if (!locName) continue
      const key = locName.toLowerCase()
      if (seenLoc.has(key)) continue
      const loc = projectData.locations!.find((l) => l.name.toLowerCase() === key)
      if (!loc) continue
      const viewHint = hashIdx === -1 ? null : panel.location.slice(hashIdx + 1).trim()
      const images = loc.images ?? []
      // Prefer the view-matching image, else isSelected, else imageIndex=0
      const viewMatch = viewHint
        ? images.find((img) => (img.viewName || '').trim().toLowerCase() === viewHint.toLowerCase())
        : null
      const selected = images.find((img) => img.isSelected)
      const primary = images.find((img) => (img.imageIndex ?? 0) === 0) ?? images[0]
      const pickedRaw = (viewMatch?.imageUrl) || (selected?.imageUrl) || (primary?.imageUrl)
      const publicUrl = toSignedUrlIfCos(pickedRaw, 7200)
      if (!publicUrl) continue
      seenLoc.add(key)
      sceneSubjects.push({ name: loc.name, imageUrls: [publicUrl] })
    }
  }

  const subjectInfos = [...characterSubjects, ...sceneSubjects].slice(0, 3)

  // Pull dialogue lines that script_to_storyboard matched to any of the
  // panels we're sending. Without this Kling Omni's generate_audio:true
  // produces a generic ambient/talking soundtrack instead of the script's
  // dialogue — the model has no idea what was supposed to be said. The
  // 「角色说："对白"」 syntax is what Kling 3.0 Omni's prompt parser uses
  // to drive lip-sync + dub when generate_audio is on (matches the
  // examples in agent_storyboard_plan.zh.txt's 对话场景 section).
  const panelIds = validPanels.map((p) => p.id)
  const voiceLines = panelIds.length > 0
    ? await prisma.novelPromotionVoiceLine.findMany({
        where: { matchedPanelId: { in: panelIds } },
        orderBy: [{ matchedPanelIndex: 'asc' }, { lineIndex: 'asc' }],
        select: { matchedPanelId: true, speaker: true, content: true },
      })
    : []
  const dialogueByPanel = new Map<string, Array<{ speaker: string; content: string }>>()
  for (const line of voiceLines) {
    if (!line.matchedPanelId) continue
    const content = (line.content ?? '').trim()
    if (!content) continue
    const speaker = (line.speaker ?? '').trim() || '旁白'
    const arr = dialogueByPanel.get(line.matchedPanelId) ?? []
    arr.push({ speaker, content })
    dialogueByPanel.set(line.matchedPanelId, arr)
  }

  await reportTaskProgress(job, 30, { stage: 'submit_generation_b_path' })

  // Branch on mode: customize gets per-shot multi_prompt entries with
  // explicit durations; intelligence keeps the legacy combined-prompt
  // path so existing callers remain bit-for-bit identical to pre-fix
  // behaviour. Both paths share dialogue injection.
  let generateOptions: Record<string, unknown>
  let resolvedDurations: number[] | undefined
  let resolvedTotal: number
  let intelligencePromptSource: 'panels' | 'raw' | 'seedance' = 'seedance'

  if (multiShotMode === 'customize') {
    const { durations, totalDuration } = distributeShotDurations(validPanels.length, panelDurations)
    const multiPrompt = buildBPathCustomizePrompts(validPanels, dialogueByPanel, durations)
    if (multiPrompt.length === 0) {
      throw new Error('MULTI_SHOT_PROMPT_EMPTY: every panel had empty videoPrompt + description')
    }
    // If shots were dropped (empty visual + no dialogue), recompute the
    // total so Kling's "sum of per-shot durations == Duration" invariant
    // still holds — buildBPathCustomizePrompts re-numbers indices.
    const finalTotal = multiPrompt.reduce((s, p) => s + p.duration, 0)
    resolvedDurations = multiPrompt.map((p) => p.duration)
    resolvedTotal = finalTotal

    logger.info({
      message: 'B path multi-shot submit (customize)',
      details: {
        videoModel,
        shotCount: multiPrompt.length,
        subjectCount: subjectInfos.length,
        durations: resolvedDurations,
        totalDuration: finalTotal,
        dialogueLineCount: voiceLines.length,
      },
    })

    // Tencent API treats top-level Prompt as semantically ignored in
    // customize mode but still validates non-empty (fails with ret:1201
    // "prompt cannot be empty" otherwise). Use the combined prompt as a
    // safe non-empty payload — the model uses multi_prompt entries for
    // actual generation.
    const placeholderPrompt = buildBPathCombinedPrompt(validPanels, dialogueByPanel)
    generateOptions = {
      prompt: placeholderPrompt,
      duration: finalTotal,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(sound !== undefined ? { generateAudio: sound } : {}),
      subjectInfos,
      klingMultiShot: {
        multi_shot: true,
        shot_type: 'customize',
        multi_prompt: multiPrompt,
      },
      outputComplianceCheck: 'Enabled',
    }
  } else {
    // Intelligence mode. Three prompt sources:
    //  1. Caller-supplied rawPrompt — wins over everything (e.g. user
    //     paste of a hand-crafted Seedance segment).
    //  2. promptStyle='auto-seedance' (default) — auto-assemble
    //     time-indexed entity-tagged prompt from panel data.
    //  3. promptStyle='panel-numbered' — legacy `镜头N:` concatenation
    //     kept for back-compat with pre-2026-05-01 callers.
    const promptStyle = params.promptStyle ?? 'auto-seedance'
    let primaryPrompt: string
    let promptSource: 'panels' | 'raw' | 'seedance'
    if (typeof rawPrompt === 'string' && rawPrompt.trim().length > 0) {
      promptSource = 'raw'
      const trimmed = rawPrompt.trim()
      const dialogueAppendix = Array.from(dialogueByPanel.values())
        .flat()
        .map((d) => `${d.speaker}说："${d.content}"`)
        .join(' ')
      primaryPrompt = dialogueAppendix ? `${trimmed}\n\n${dialogueAppendix}` : trimmed
    } else if (promptStyle === 'auto-seedance') {
      promptSource = 'seedance'
      primaryPrompt = buildSeedancePrompt(validPanels, dialogueByPanel)
    } else {
      promptSource = 'panels'
      primaryPrompt = buildBPathCombinedPrompt(validPanels, dialogueByPanel)
    }
    if (!primaryPrompt.trim()) {
      throw new Error('MULTI_SHOT_PROMPT_EMPTY: every panel had empty videoPrompt + description')
    }
    // Auto-seedance and rawPrompt cover the full 15s window (each shot
    // gets a guaranteed slice via distributeShotDurations); legacy
    // panel-numbered keeps the conservative 10s default to preserve
    // pre-2026-05-01 behaviour for opted-out callers.
    resolvedTotal = promptSource === 'panels'
      ? (validPanels.length >= 3 ? 10 : 5)
      : KLING_OMNI_MAX_TOTAL_DURATION

    logger.info({
      message: 'B path multi-shot submit (intelligence)',
      details: {
        videoModel,
        shotCount: validPanels.length,
        subjectCount: subjectInfos.length,
        promptLength: primaryPrompt.length,
        promptSource,
        dialogueLineCount: voiceLines.length,
        totalDuration: resolvedTotal,
      },
    })

    generateOptions = {
      prompt: primaryPrompt,
      duration: resolvedTotal,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(sound !== undefined ? { generateAudio: sound } : {}),
      subjectInfos,
      klingMultiShot: { multi_shot: 'intelligence' },
      outputComplianceCheck: 'Enabled',
    }
    // Stash for the function's return shape.
    intelligencePromptSource = promptSource
  }
  // generateVideo's option type is intentionally narrow (only standard
  // fields). Tencent-specific keys (subjectInfos / klingMultiShot /
  // outputComplianceCheck) ride through as extras and are picked up by
  // the TencentVODVideoGenerator typed options.
  const generateResult = await generateVideo(
    userId,
    videoModel,
    '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generateOptions as any,
  )

  if (!generateResult.success) {
    throw new Error(generateResult.error || 'Tencent VOD multi-shot submit failed')
  }
  const externalId = typeof generateResult.externalId === 'string' ? generateResult.externalId.trim() : ''
  if (!externalId) {
    throw new Error('Tencent VOD multi-shot returned no externalId')
  }

  const polled = await waitExternalResult(job, externalId, userId, {
    progressStart: 35,
    progressEnd: 90,
  })

  await assertTaskActive(job, 'persist_multi_shot_video_b_path')

  const storyboardId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(polled.url, 'multi-shot-video-b', storyboardId)
  await reportTaskProgress(job, 95, { stage: 'persist' })

  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: { multiShotVideoUrl: cosKey },
  })

  return {
    storyboardId,
    multiShotVideoUrl: cosKey,
    shotCount: validPanels.length,
    subjectCount: subjectInfos.length,
    path: 'B',
    multiShotMode,
    ...(resolvedDurations ? { durations: resolvedDurations } : {}),
    ...(multiShotMode === 'intelligence' ? { promptSource: intelligencePromptSource } : {}),
  }
}
