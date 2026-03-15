import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { logAIAnalysis } from '@/lib/logging/semantic'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type { ScriptToStoryboardStepMeta, ScriptToStoryboardStepOutput } from '@/lib/novel-promotion/script-to-storyboard/orchestrator'
import type { TaskJobData } from '@/lib/task/types'

export function createRunStep(params: {
  job: Job<TaskJobData>
  model: string
  projectId: string
  projectName: string
  temperature: number
  reasoning: boolean
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
}) {
  const { job, model, projectId, projectName, temperature, reasoning, reasoningEffort } = params

  return async (
    meta: ScriptToStoryboardStepMeta,
    prompt: string,
    action: string,
    _maxOutputTokens: number,
  ): Promise<ScriptToStoryboardStepOutput> => {
    void _maxOutputTokens
    await assertTaskActive(job, `script_to_storyboard_step:${meta.stepId}`)
    const progress = 15 + Math.min(70, Math.floor((meta.stepIndex / Math.max(1, meta.stepTotal)) * 70))
    await reportTaskProgress(job, progress, {
      stage: 'script_to_storyboard_step',
      stageLabel: 'progress.stage.scriptToStoryboardStep',
      displayMode: 'detail',
      message: meta.stepTitle,
      stepId: meta.stepId,
      stepAttempt: meta.stepAttempt || 1,
      stepTitle: meta.stepTitle,
      stepIndex: meta.stepIndex,
      stepTotal: meta.stepTotal,
    })

    // Log prompt input
    logAIAnalysis(job.data.userId, 'worker', projectId, projectName, {
      action: `SCRIPT_TO_STORYBOARD_PROMPT:${action}`,
      input: { stepId: meta.stepId, stepTitle: meta.stepTitle, prompt },
      model,
    })

    const output = await executeAiTextStep({
      userId: job.data.userId,
      model,
      messages: [{ role: 'user', content: prompt }],
      projectId,
      action,
      meta,
      temperature,
      reasoning,
      reasoningEffort,
    })

    // Log AI response output (full raw text included for JSON parse debugging)
    logAIAnalysis(job.data.userId, 'worker', projectId, projectName, {
      action: `SCRIPT_TO_STORYBOARD_OUTPUT:${action}`,
      output: {
        stepId: meta.stepId,
        stepTitle: meta.stepTitle,
        rawText: output.text,
        textLength: output.text.length,
        reasoningLength: output.reasoning.length,
      },
      model,
    })

    return {
      text: output.text,
      reasoning: output.reasoning,
    }
  }
}
