import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { logAIAnalysis } from '@/lib/logging/semantic'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import {
  runStoryToScriptOrchestrator,
  type StoryToScriptStepMeta,
  type StoryToScriptStepOutput,
  type StoryToScriptOrchestratorResult,
} from '@/lib/novel-promotion/story-to-script/orchestrator'
import { executePipelineGraph, type GraphExecutorState } from '@/lib/run-runtime/graph-executor'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { TaskJobData } from '@/lib/task/types'

export type StoryToScriptGraphState = GraphExecutorState & {
  orchestratorResult: StoryToScriptOrchestratorResult | null
}

export function isReasoningEffort(value: unknown): value is 'minimal' | 'low' | 'medium' | 'high' {
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'
}

export function buildRunStep(params: {
  job: Job<TaskJobData>
  projectId: string
  projectName: string
  model: string
  temperature: number
  reasoning: boolean
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
}) {
  const { job, projectId, projectName, model, temperature, reasoning, reasoningEffort } = params

  return async (
    meta: StoryToScriptStepMeta,
    prompt: string,
    action: string,
    _maxOutputTokens: number,
  ): Promise<StoryToScriptStepOutput> => {
    void _maxOutputTokens
    await assertTaskActive(job, `story_to_script_step:${meta.stepId}`)
    const progress = 15 + Math.min(55, Math.floor((meta.stepIndex / Math.max(1, meta.stepTotal)) * 55))
    await reportTaskProgress(job, progress, {
      stage: 'story_to_script_step',
      stageLabel: 'progress.stage.storyToScriptStep',
      displayMode: 'detail',
      message: meta.stepTitle,
      stepId: meta.stepId,
      stepAttempt: meta.stepAttempt || 1,
      stepTitle: meta.stepTitle,
      stepIndex: meta.stepIndex,
      stepTotal: meta.stepTotal,
    })

    logAIAnalysis(job.data.userId, 'worker', projectId, projectName, {
      action: `STORY_TO_SCRIPT_PROMPT:${action}`,
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

    logAIAnalysis(job.data.userId, 'worker', projectId, projectName, {
      action: `STORY_TO_SCRIPT_OUTPUT:${action}`,
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

export async function runStoryToScriptPipeline(params: {
  runId: string
  projectId: string
  userId: string
  content: string
  baseCharacters: string[]
  baseLocations: string[]
  baseCharacterIntroductions: { name: string; introduction: string }[]
  promptTemplates: {
    characterPromptTemplate: string
    locationPromptTemplate: string
    clipPromptTemplate: string
    screenplayPromptTemplate: string
  }
  runStep: (
    meta: StoryToScriptStepMeta,
    prompt: string,
    action: string,
    maxOutputTokens: number,
  ) => Promise<StoryToScriptStepOutput>
  callbacks: { flush: () => Promise<void> }
}): Promise<StoryToScriptGraphState> {
  const initialState: StoryToScriptGraphState = {
    refs: {},
    meta: {},
    orchestratorResult: null,
  }

  try {
    return await withInternalLLMStreamCallbacks(
      params.callbacks as Parameters<typeof withInternalLLMStreamCallbacks>[0],
      async () =>
        await executePipelineGraph({
          runId: params.runId,
          projectId: params.projectId,
          userId: params.userId,
          state: initialState,
          nodes: [
            {
              key: 'story_to_script_orchestrator',
              title: 'story_to_script_orchestrator',
              maxAttempts: 2,
              timeoutMs: 1000 * 60 * 15,
              run: async (context) => {
                const orchestratorResult = await runStoryToScriptOrchestrator({
                  content: params.content,
                  baseCharacters: params.baseCharacters,
                  baseLocations: params.baseLocations,
                  baseCharacterIntroductions: params.baseCharacterIntroductions,
                  promptTemplates: params.promptTemplates,
                  runStep: params.runStep,
                })

                context.state.orchestratorResult = orchestratorResult
                return {
                  output: {
                    clipCount: orchestratorResult.summary.clipCount,
                    screenplaySuccessCount: orchestratorResult.summary.screenplaySuccessCount,
                    screenplayFailedCount: orchestratorResult.summary.screenplayFailedCount,
                  },
                }
              },
            },
          ],
        }),
    )
  } finally {
    await params.callbacks.flush()
  }
}
