import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { TaskTerminatedError } from '@/lib/task/errors'
import { reportTaskProgress } from '@/lib/workers/shared'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { ScriptToStoryboardStepMeta, ScriptToStoryboardStepOutput } from '@/lib/novel-promotion/script-to-storyboard/orchestrator'
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

export async function persistVoiceLines(params: {
  episodeId: string
  voiceLineRows: JsonRecord[]
  persistedStoryboards: PersistedStoryboard[]
}): Promise<Array<{ id: string }>> {
  const { episodeId, voiceLineRows, persistedStoryboards } = params

  const panelIdByStoryboardPanel = new Map<string, string>()
  for (const storyboard of persistedStoryboards) {
    for (const panel of storyboard.panels) {
      panelIdByStoryboardPanel.set(`${storyboard.storyboardId}:${panel.panelIndex}`, panel.id)
    }
  }

  return await prisma.$transaction(async (tx) => {
    await tx.novelPromotionVoiceLine.deleteMany({ where: { episodeId } })
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
      if (matchedPanel !== null) {
        if (!matchedStoryboardId || matchedPanelIndex === null) {
          throw new Error(`voice line ${i + 1} has invalid matchedPanel reference`)
        }
        const panelKey = `${matchedStoryboardId}:${matchedPanelIndex}`
        const resolvedPanelId = panelIdByStoryboardPanel.get(panelKey)
        if (!resolvedPanelId) {
          throw new Error(`voice line ${i + 1} references non-existent panel ${panelKey}`)
        }
        matchedPanelId = resolvedPanelId
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
          matchedStoryboardId: matchedPanelId ? matchedStoryboardId : null,
          matchedPanelIndex,
        },
        select: { id: true },
      })
      created.push(createdRow)
    }
    return created
  }, { timeout: 15000 })
}
