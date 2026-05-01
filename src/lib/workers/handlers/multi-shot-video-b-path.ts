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
  imageUrl: string | null
  storyboardId: string
}

interface BPathProjectData {
  characters?: CharacterForBPath[]
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
 */
function buildShotBody(
  panel: Pick<BPathPanel, 'id' | 'description' | 'videoPrompt'>,
  dialogueByPanelId: ReadonlyMap<string, BPathDialogueLine[]>,
): string {
  const visual = (panel.videoPrompt || panel.description || '').trim()
  const dialogues = (dialogueByPanelId.get(panel.id) ?? [])
    .map((d) => `${d.speaker}说："${d.content}"`)
    .join(' ')
  return dialogues ? `${visual}\n${dialogues}`.trim() : visual
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
}): Promise<{ storyboardId: string; multiShotVideoUrl: string; shotCount: number; subjectCount: number; path: 'B'; multiShotMode: 'intelligence' | 'customize'; durations?: number[] }> {
  const { job, validPanels, projectData, videoModel, sound, aspectRatio, panelDurations } = params
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
  const subjectInfos = Array.from(subjectMap.values())
    .slice(0, 3)
    .map((s) => ({ name: s.name, imageUrls: [s.imageUrl] }))

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

    generateOptions = {
      // Customize mode ignores top-level Prompt per Tencent doc, but the
      // generator's required field still expects a string — pass empty.
      prompt: '',
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
    const combinedPrompt = buildBPathCombinedPrompt(validPanels, dialogueByPanel)
    if (!combinedPrompt.trim()) {
      throw new Error('MULTI_SHOT_PROMPT_EMPTY: every panel had empty videoPrompt + description')
    }
    resolvedTotal = validPanels.length >= 3 ? 10 : 5

    logger.info({
      message: 'B path multi-shot submit (intelligence)',
      details: {
        videoModel,
        shotCount: validPanels.length,
        subjectCount: subjectInfos.length,
        promptLength: combinedPrompt.length,
        dialogueLineCount: voiceLines.length,
        totalDuration: resolvedTotal,
      },
    })

    generateOptions = {
      prompt: combinedPrompt,
      duration: resolvedTotal,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(sound !== undefined ? { generateAudio: sound } : {}),
      subjectInfos,
      klingMultiShot: { multi_shot: 'intelligence' },
      outputComplianceCheck: 'Enabled',
    }
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
  }
}
