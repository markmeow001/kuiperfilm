import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { logAIAnalysis } from '@/lib/logging/semantic'
import { onProjectNameAvailable } from '@/lib/logging/file-writer'
import { buildCharactersIntroduction } from '@/lib/constants'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { executePipelineGraph, type GraphExecutorState } from '@/lib/run-runtime/graph-executor'
import {
  runScriptToStoryboardOrchestrator,
  JsonParseError,
  type ScriptToStoryboardStepMeta,
  type ScriptToStoryboardOrchestratorResult,
} from '@/lib/novel-promotion/script-to-storyboard/orchestrator'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import {
  buildStoryboardJson,
  parseEffort,
  parseTemperature,
  persistSingleClipStoryboard,
  type PersistedStoryboard,
} from './script-to-storyboard-helpers'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'
import { pickStoryboardDetailPromptId } from '@/lib/novel-promotion/storyboard-prompt-router'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { createRunStep } from './script-to-storyboard-run-step'
import { runVoiceAnalyzeWithRetry, persistVoiceLines } from './script-to-storyboard-voice'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/api-config'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { logError as _ulogError, logInfo as _ulogInfo } from '@/lib/logging/core'

type AnyObj = Record<string, unknown>

function isReasoningEffort(value: unknown): value is 'minimal' | 'low' | 'medium' | 'high' {
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'
}

export async function handleScriptToStoryboardTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const episodeIdRaw = typeof payload.episodeId === 'string' ? payload.episodeId : (job.data.episodeId || '')
  const episodeId = episodeIdRaw.trim()
  const inputModel = typeof payload.model === 'string' ? payload.model.trim() : ''
  const reasoning = payload.reasoning !== false
  const requestedReasoningEffort = parseEffort(payload.reasoningEffort)
  const temperature = parseTemperature(payload.temperature)

  if (!episodeId) {
    throw new Error('episodeId is required')
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      mode: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }
  if (project.mode !== 'novel-promotion') {
    throw new Error('Not a novel promotion project')
  }

  // Register project name for per-project log file routing
  onProjectNameAvailable(projectId, project.name)

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
      locations: true,
    },
  })
  if (!novelData) {
    throw new Error('Novel promotion data not found')
  }

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!episode || episode.novelPromotionProjectId !== novelData.id) {
    throw new Error('Episode not found')
  }
  const clips = episode.clips || []
  if (clips.length === 0) {
    throw new Error('No clips found')
  }

  const model = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel,
    projectAnalysisModel: novelData.analysisModel,
  })
  const llmCapabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId,
    userId: job.data.userId,
    modelType: 'llm',
    modelKey: model,
  })
  const capabilityReasoningEffort = llmCapabilityOptions.reasoningEffort
  const reasoningEffort = requestedReasoningEffort
    || (isReasoningEffort(capabilityReasoningEffort) ? capabilityReasoningEffort : 'high')

  await reportTaskProgress(job, 10, {
    stage: 'script_to_storyboard_prepare',
    stageLabel: 'progress.stage.scriptToStoryboardPrepare',
    displayMode: 'detail',
  })

  const phase1PlanTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_PLAN, job.data.locale)
  const phase2CinematographyTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER, job.data.locale)
  const phase2ActingTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_ACTING_DIRECTION, job.data.locale)
  // Phase 3 prompt varies per video provider — Kling-* uses the Kling-tuned variant.
  const phase3DetailTemplate = getPromptTemplate(pickStoryboardDetailPromptId(novelData.videoModel), job.data.locale)

  const streamContext = createWorkerLLMStreamContext(job, 'script_to_storyboard')
  const callbacks = createWorkerLLMStreamCallbacks(job, streamContext)

  const runStep = createRunStep({
    job,
    model,
    projectId,
    projectName: project.name,
    temperature,
    reasoning,
    reasoningEffort,
  })

  const payloadMeta = typeof payload.meta === 'object' && payload.meta !== null
    ? (payload.meta as AnyObj)
    : {}
  const runId = typeof payload.runId === 'string' && payload.runId.trim()
    ? payload.runId.trim()
    : (typeof payloadMeta.runId === 'string' ? payloadMeta.runId.trim() : '')
  if (!runId) {
    throw new Error('runId is required for script_to_storyboard pipeline')
  }

  type ScriptToStoryboardGraphState = GraphExecutorState & {
    orchestratorResult: ScriptToStoryboardOrchestratorResult | null
  }
  const initialState: ScriptToStoryboardGraphState = {
    refs: {},
    meta: {},
    orchestratorResult: null,
  }

  // 2026-05-01 fix: removed the upfront
  //   `prisma.novelPromotionStoryboard.deleteMany({ episodeId })`
  // that used to live here. It ran outside any transaction, so a
  // downstream FK violation in persistSingleClipStoryboard (e.g.
  // clipId no longer exists because a parallel clips_build replaced
  // clips) left the user with ZERO panels — user reported
  // 「一直消失」. Atomic per-clip replacement now happens inside each
  // persistSingleClipStoryboard call so a failure on clip N doesn't
  // wipe clips 1..N-1.
  const persistedSoFar: PersistedStoryboard[] = []

  const pipelineState = await (async () => {
    try {
      return await withInternalLLMStreamCallbacks(
        callbacks,
        async () =>
          await executePipelineGraph({
            runId,
            projectId,
            userId: job.data.userId,
            state: initialState,
            nodes: [
              {
                key: 'script_to_storyboard_orchestrator',
                title: 'script_to_storyboard_orchestrator',
                maxAttempts: 2,
                timeoutMs: 1000 * 60 * 45,
                run: async (context) => {
                  const nextResult = await runScriptToStoryboardOrchestrator({
                    clips: clips.map((clip) => ({
                      id: clip.id,
                      content: clip.content,
                      characters: clip.characters,
                      location: clip.location,
                      screenplay: clip.screenplay,
                    })),
                    targetDuration: novelData.targetDuration ?? 60,
                    novelPromotionData: {
                      characters: novelData.characters || [],
                      locations: novelData.locations || [],
                      openingPacing: novelData.openingPacing,
                    },
                    promptTemplates: {
                      phase1PlanTemplate,
                      phase2CinematographyTemplate,
                      phase2ActingTemplate,
                      phase3DetailTemplate,
                    },
                    runStep,
                    onClipComplete: async (clipResult) => {
                      const persisted = await persistSingleClipStoryboard(projectId, episodeId, clipResult, novelData.generationMode)
                      // Race-safe persist returns null when the clip
                      // it was meant to replace was deleted between
                      // orchestrator init and persist (e.g. clips_build
                      // replaced clips). Skip but keep going.
                      if (persisted) persistedSoFar.push(persisted)
                    },
                  })

                  context.state.orchestratorResult = nextResult
                  return {
                    output: {
                      clipCount: nextResult.summary.clipCount,
                      totalPanelCount: nextResult.summary.totalPanelCount,
                    },
                  }
                },
              },
            ],
          }),
      )
    } catch (err) {
      if (err instanceof JsonParseError) {
        logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
          action: 'SCRIPT_TO_STORYBOARD_PARSE_ERROR',
          error: {
            message: err.message,
            rawTextPreview: err.rawText.slice(0, 3000),
            rawTextLength: err.rawText.length,
          },
          model,
        })
      }
      throw err
    } finally {
      await callbacks.flush()
    }
  })()

  const orchestratorResult = pipelineState.orchestratorResult
  if (!orchestratorResult) {
    throw new Error('script_to_storyboard orchestrator produced no result')
  }

  await reportTaskProgress(job, 80, {
    stage: 'script_to_storyboard_persist',
    stageLabel: 'progress.stage.scriptToStoryboardPersist',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'script_to_storyboard_persist')

  // Storyboards already persisted incrementally via onClipComplete
  const persistedStoryboards = persistedSoFar

  if (!episode.novelText || !episode.novelText.trim()) {
    throw new Error('No novel text to analyze')
  }

  const voicePrompt = buildPrompt({
    promptId: PROMPT_IDS.NP_VOICE_ANALYSIS,
    locale: job.data.locale,
    variables: {
      input: episode.novelText,
      characters_lib_name: (novelData.characters || []).length > 0
        ? (novelData.characters || []).map((item) => item.name).join('、')
        : '无',
      characters_introduction: buildCharactersIntroduction(novelData.characters || []),
      storyboard_json: buildStoryboardJson(persistedStoryboards),
    },
  })

  const voiceStepMeta: ScriptToStoryboardStepMeta = {
    stepId: 'voice_analyze',
    stepTitle: 'progress.streamStep.voiceAnalyze',
    stepIndex: orchestratorResult.summary.totalStepCount,
    stepTotal: orchestratorResult.summary.totalStepCount,
  }

  const voiceLineRows = await runVoiceAnalyzeWithRetry({
    job,
    callbacks,
    voicePrompt,
    voiceStepMeta,
    runStep,
  })

  await assertTaskActive(job, 'script_to_storyboard_voice_persist')

  const createdVoiceLines = await persistVoiceLines({
    episodeId,
    voiceLineRows,
    persistedStoryboards,
    // Pass raw script so screenplay-format dialogue ("王玄OS：xxx" /
    // "桃桃（哽咽VO）：xxx") the voice_analysis prompt can't parse is
    // backfilled by deterministic regex extraction. See
    // `project_kuiperfilm_dialogue_extraction_bug` memory.
    rawScript: episode.novelText,
  })

  await reportTaskProgress(job, 96, {
    stage: 'script_to_storyboard_persist_done',
    stageLabel: 'progress.stage.scriptToStoryboardPersistDone',
    displayMode: 'detail',
  })

  // 2026-05-03 — auto-cascade panel image generation. Without this
  // every newly-created panel sits with imageUrl=null until the user
  // manually clicks "一鍵生圖". Mobile review users (post-redirect)
  // saw "尚未生成" placeholders for ~16/17 panels even on freshly-
  // analysed episodes, breaking the on-the-go preview UX. Now each
  // panel gets a single-candidate IMAGE_PANEL task fanned out behind
  // BullMQ + Tencent's per-account quota — backpressure absorbs the
  // burst, image gen completes ~30-60s after script-to-storyboard
  // wraps. Opt out with payload.cascadeImageGen=false (e.g. dev
  // wanting to inspect panels before paying for image gen).
  const cascadeImageGen = payload.cascadeImageGen !== false
  if (cascadeImageGen) {
    const allPanels: Array<{ id: string; description: string | null }> = persistedStoryboards
      .flatMap((sb) => sb.panels)
    // Skip panels with no description — the worker has nothing to feed
    // the model, and the resulting "default" image isn't useful.
    const eligiblePanels = allPanels.filter((p) => (p.description ?? '').trim().length > 0)

    if (eligiblePanels.length > 0) {
      // The image worker requires a configured storyboard model.
      // Resolve once per cascade — admin fallback already applied
      // server-side, so non-admin projects inherit admin's setup.
      const projectModelConfig = await getProjectModelConfig(projectId, job.data.userId)
      const storyboardModel = projectModelConfig.storyboardModel
      let modelOk = false
      if (storyboardModel) {
        try {
          await resolveModelSelection(job.data.userId, storyboardModel, 'image')
          modelOk = true
        } catch (err) {
          _ulogError('[script-to-storyboard] cascade skipped — storyboard model unresolvable', {
            err: (err as Error).message,
            model: storyboardModel,
          })
        }
      }
      if (modelOk && storyboardModel) {
        const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
          projectId,
          userId: job.data.userId,
          modelType: 'image',
          modelKey: storyboardModel,
        })
        let submitted = 0
        for (const panel of eligiblePanels) {
          try {
            const billingPayload = {
              candidateCount: 1,
              imageModel: storyboardModel,
              ...(Object.keys(capabilityOptions).length > 0
                ? { generationOptions: capabilityOptions }
                : {}),
            }
            await submitTask({
              userId: job.data.userId,
              locale: job.data.locale,
              projectId,
              type: TASK_TYPE.IMAGE_PANEL,
              targetType: 'NovelPromotionPanel',
              targetId: panel.id,
              payload: withTaskUiPayload(billingPayload, {
                intent: 'generate',
                hasOutputAtStart: false,
              }),
              dedupeKey: `image_panel:${panel.id}:1`,
              billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
            })
            submitted += 1
          } catch (err) {
            // A single image cascade failure shouldn't kill the whole
            // storyboard task — the panel just stays imageless and the
            // user can manually retry later.
            _ulogError('[script-to-storyboard] cascade submit failed', {
              panelId: panel.id,
              err: (err as Error).message,
            })
          }
        }
        _ulogInfo('[script-to-storyboard] cascaded image gen', {
          episodeId,
          eligible: eligiblePanels.length,
          submitted,
        })
      }
    }
  }

  return {
    episodeId,
    storyboardCount: persistedStoryboards.length,
    panelCount: orchestratorResult.summary.totalPanelCount,
    voiceLineCount: createdVoiceLines.length,
    cascadedImageGen: cascadeImageGen,
  }
}
