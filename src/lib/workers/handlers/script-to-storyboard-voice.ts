import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { TaskTerminatedError } from '@/lib/task/errors'
import { reportTaskProgress } from '@/lib/workers/shared'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import type { ScriptToStoryboardStepMeta, ScriptToStoryboardStepOutput } from '@/lib/novel-promotion/script-to-storyboard/orchestrator'
import {
  dialogueDedupKey,
  extractScriptDialogues,
  inferEmotionFromContent,
  isDialogueDuplicate,
} from '@/lib/novel-promotion/script-dialogue-extractor'
import { asJsonRecord, parseVoiceLinesJson, toPositiveInt, type JsonRecord, type PersistedStoryboard } from './script-to-storyboard-helpers'
import type { TaskJobData } from '@/lib/task/types'

const MAX_VOICE_ANALYZE_ATTEMPTS = 2

type RunStepFn = (
  meta: ScriptToStoryboardStepMeta,
  prompt: string,
  action: string,
  maxOutputTokens: number,
) => Promise<ScriptToStoryboardStepOutput>

type WorkerCallbacks = {
  flush: () => Promise<void>
}

export async function runVoiceAnalyzeWithRetry(params: {
  job: Job<TaskJobData>
  callbacks: WorkerCallbacks
  voicePrompt: string
  voiceStepMeta: ScriptToStoryboardStepMeta
  runStep: RunStepFn
}): Promise<JsonRecord[]> {
  const { job, callbacks, voicePrompt, voiceStepMeta, runStep } = params

  let voiceLineRows: JsonRecord[] | null = null
  let voiceLastError: Error | null = null

  try {
    for (let voiceAttempt = 1; voiceAttempt <= MAX_VOICE_ANALYZE_ATTEMPTS; voiceAttempt++) {
      const meta: ScriptToStoryboardStepMeta = {
        ...voiceStepMeta,
        stepAttempt: voiceAttempt,
      }
      try {
        const voiceOutput = await withInternalLLMStreamCallbacks(
          callbacks,
          async () => await runStep(meta, voicePrompt, 'voice_analyze', 2600),
        )
        voiceLineRows = parseVoiceLinesJson(voiceOutput.text)
        break
      } catch (error) {
        if (error instanceof TaskTerminatedError) {
          throw error
        }
        voiceLastError = error instanceof Error ? error : new Error(String(error))
        if (voiceAttempt < MAX_VOICE_ANALYZE_ATTEMPTS) {
          await reportTaskProgress(job, 84, {
            stage: 'script_to_storyboard_step',
            stageLabel: 'progress.stage.scriptToStoryboardStep',
            displayMode: 'detail',
            message: `台词分析失败，准备重试 (${voiceAttempt + 1}/${MAX_VOICE_ANALYZE_ATTEMPTS})`,
            stepId: voiceStepMeta.stepId,
            stepAttempt: voiceAttempt + 1,
            stepTitle: voiceStepMeta.stepTitle,
            stepIndex: voiceStepMeta.stepIndex,
            stepTotal: voiceStepMeta.stepTotal,
          })
        }
      }
    }
  } finally {
    await callbacks.flush()
  }

  if (!voiceLineRows) {
    throw voiceLastError!
  }
  return voiceLineRows
}

/**
 * Deterministic write-side enrichment that pairs with the LLM result.
 *
 * The voice_analysis prompt only recognises quoted dialogue, so when
 * an input script uses screenplay colon format (王玄OS：xxx /
 * 桃桃（哽咽VO）：xxx) every dialogue line is silently dropped and the
 * episode ends up with an empty voice_lines table — see
 * `project_kuiperfilm_dialogue_extraction_bug` memory. This function
 * scans the raw episode script with a deterministic regex and appends
 * any dialogue the LLM missed.
 *
 * LLM rows always win when both find the same dialogue (LLM carries
 * matchedPanel + curated emotionStrength). Regex-only rows are appended
 * with matchedPanel: null and a heuristic emotionStrength.
 */
export function enrichVoiceLinesFromScript(
  voiceLineRows: JsonRecord[],
  rawScript: string | null | undefined,
): JsonRecord[] {
  if (!rawScript || !rawScript.trim()) return voiceLineRows
  const regexExtracted = extractScriptDialogues(rawScript)
  if (regexExtracted.length === 0) return voiceLineRows

  const llmKeys = new Set<string>()
  let highestLineIndex = 0
  for (const row of voiceLineRows) {
    const speaker = typeof row.speaker === 'string' ? row.speaker.trim() : ''
    const content = typeof row.content === 'string' ? row.content : ''
    if (speaker && content) {
      llmKeys.add(dialogueDedupKey(speaker, content))
    }
    const idx = toPositiveInt(row.lineIndex)
    if (idx !== null && idx > highestLineIndex) highestLineIndex = idx
  }

  const enrichment: JsonRecord[] = []
  let nextLineIndex = Math.max(highestLineIndex, voiceLineRows.length) + 1
  for (const dialogue of regexExtracted) {
    const key = dialogueDedupKey(dialogue.speaker, dialogue.content)
    if (isDialogueDuplicate(key, llmKeys)) continue
    enrichment.push({
      lineIndex: nextLineIndex++,
      speaker: dialogue.speaker,
      content: dialogue.content,
      emotionStrength: inferEmotionFromContent(dialogue.content, dialogue.modifier),
      matchedPanel: null,
    })
  }

  if (enrichment.length === 0) return voiceLineRows
  return [...voiceLineRows, ...enrichment]
}

export async function persistVoiceLines(params: {
  episodeId: string
  voiceLineRows: JsonRecord[]
  persistedStoryboards: PersistedStoryboard[]
  // Raw episode script — when supplied, regex-extracted dialogue the
  // LLM missed is appended via enrichVoiceLinesFromScript. Optional so
  // legacy callers that don't have the script handy still compile.
  rawScript?: string | null
}): Promise<Array<{ id: string }>> {
  const { episodeId, persistedStoryboards, rawScript } = params
  const voiceLineRows = enrichVoiceLinesFromScript(params.voiceLineRows, rawScript)

  const panelIdByStoryboardPanel = new Map<string, string>()
  for (const storyboard of persistedStoryboards) {
    for (const panel of storyboard.panels) {
      panelIdByStoryboardPanel.set(`${storyboard.storyboardId}:${panel.panelIndex}`, panel.id)
    }
  }

  return await prisma.$transaction(async (tx) => {
    await tx.novelPromotionVoiceLine.deleteMany({ where: { episodeId } })

    // 2026-05-16 (F-QA-2) — verify panel IDs are still live in the
    // DB INSIDE this transaction before we reference them. Background:
    // persistedStoryboards is an in-memory snapshot from earlier
    // persistSingleClipStoryboard calls. If a concurrent
    // script_to_storyboard_run for the same episode (user double-clicked
    // 重新分析, or a retry got dispatched mid-run) wiped+rewrote panels
    // between then and now, the in-memory IDs are stale. Trying to
    // INSERT a voiceLine with a stale matchedPanelId hits a Prisma
    // foreign-key violation and the WHOLE batch fails, which is the
    // user-reported "episode 2 stuck with Foreign key constraint
    // violated" bug.
    //
    // Fetching live panel IDs once at transaction start lets us
    // distinguish two cases below:
    //   (a) LLM hallucination — referenced (storyboardId, panelIndex)
    //       was never persisted by THIS run → throw (real LLM bug,
    //       worth surfacing as analyze failure).
    //   (b) Concurrent deletion — referenced IDs WERE persisted by
    //       this run but no longer exist → log warn + drop the panel
    //       binding (set matchedPanelId = null) so the voice line
    //       still saves. Better degraded data than no data.
    const inMemoryPanelIds = new Set(
      Array.from(panelIdByStoryboardPanel.values()),
    )
    const livePanelRows =
      inMemoryPanelIds.size > 0
        ? await tx.novelPromotionPanel.findMany({
            where: { id: { in: Array.from(inMemoryPanelIds) } },
            select: { id: true },
          })
        : []
    const livePanelIds = new Set(livePanelRows.map((p) => p.id))
    let staleBindingsSkipped = 0

    const created: Array<{ id: string }> = []
    for (let i = 0; i < voiceLineRows.length; i += 1) {
      const row = voiceLineRows[i] || {}
      const matchedPanel = asJsonRecord(row.matchedPanel)
      const matchedStoryboardId =
        matchedPanel && typeof matchedPanel.storyboardId === 'string'
          ? matchedPanel.storyboardId.trim()
          : null
      const matchedPanelIndex = matchedPanel ? toPositiveInt(matchedPanel.panelIndex) : null
      let matchedPanelId: string | null = null
      let effectiveMatchedStoryboardId: string | null = null
      let effectiveMatchedPanelIndex: number | null = null
      if (matchedPanel !== null) {
        if (!matchedStoryboardId || matchedPanelIndex === null) {
          throw new Error(`voice line ${i + 1} has invalid matchedPanel reference`)
        }
        const panelKey = `${matchedStoryboardId}:${matchedPanelIndex}`
        const resolvedPanelId = panelIdByStoryboardPanel.get(panelKey)
        if (!resolvedPanelId) {
          // Case (a): LLM produced a (storyboardId, panelIndex) we
          // never persisted in this run. Real hallucination — keep
          // the historical fail-fast behaviour.
          throw new Error(`voice line ${i + 1} references non-existent panel ${panelKey}`)
        }
        if (!livePanelIds.has(resolvedPanelId)) {
          // Case (b): panel WAS persisted by this run but got wiped
          // by a concurrent transaction. Drop the binding rather
          // than tank the whole voice analysis output.
          staleBindingsSkipped += 1
        } else {
          matchedPanelId = resolvedPanelId
          effectiveMatchedStoryboardId = matchedStoryboardId
          effectiveMatchedPanelIndex = matchedPanelIndex
        }
      }

      if (typeof row.emotionStrength !== 'number' || !Number.isFinite(row.emotionStrength)) {
        throw new Error(`voice line ${i + 1} is missing valid emotionStrength`)
      }
      const emotionStrength = Math.min(1, Math.max(0.1, row.emotionStrength))

      if (typeof row.lineIndex !== 'number' || !Number.isFinite(row.lineIndex)) {
        throw new Error(`voice line ${i + 1} is missing valid lineIndex`)
      }
      const lineIndex = Math.floor(row.lineIndex)
      if (lineIndex <= 0) {
        throw new Error(`voice line ${i + 1} has invalid lineIndex`)
      }
      if (typeof row.speaker !== 'string' || !row.speaker.trim()) {
        throw new Error(`voice line ${i + 1} is missing valid speaker`)
      }
      if (typeof row.content !== 'string' || !row.content.trim()) {
        throw new Error(`voice line ${i + 1} is missing valid content`)
      }

      const createdRow = await tx.novelPromotionVoiceLine.create({
        data: {
          episodeId,
          lineIndex,
          speaker: row.speaker.trim(),
          content: row.content,
          emotionStrength,
          matchedPanelId,
          matchedStoryboardId: effectiveMatchedStoryboardId,
          matchedPanelIndex: effectiveMatchedPanelIndex,
        },
        select: { id: true },
      })
      created.push(createdRow)
    }
    if (staleBindingsSkipped > 0) {
      _ulogInfo('[persistVoiceLines] dropped stale panel bindings', {
        episodeId,
        staleBindingsSkipped,
        totalVoiceLines: voiceLineRows.length,
      })
    }
    return created
  }, { timeout: 15000 })
}
