import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { generateVoiceLine } from '@/lib/voice/generate-voice-line'
import { QUEUE_NAME, rateLimitAwareBackoff } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { assertTaskActive } from './utils'
import { handleVoiceDesignTask } from './handlers/voice-design'
import { handleCanvasTtsTask } from './handlers/canvas-tts'
import {
  claimVoiceLineCompletion,
  reconcileVoiceLineTerminalState,
} from '@/lib/voice/voice-line-publication'
import { parseVoiceLineGenerationInput } from '@/lib/voice/voice-generation-scope'
import { enforceVoiceDesignConsentBoundary } from '@/lib/voice/voice-source-consent-policy'

type AnyObj = Record<string, unknown>

async function handleVoiceLineTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const lineId = typeof job.data.targetId === 'string' ? job.data.targetId.trim() : ''
  const taskId = typeof job.data.taskId === 'string' ? job.data.taskId.trim() : ''
  const episodeId = typeof job.data.episodeId === 'string' ? job.data.episodeId.trim() : ''
  const payloadLineId = typeof payload.lineId === 'string' ? payload.lineId.trim() : ''
  const payloadEpisodeId = typeof payload.episodeId === 'string' ? payload.episodeId.trim() : ''
  const audioModel = typeof payload.audioModel === 'string' && payload.audioModel.trim()
    ? payload.audioModel.trim()
    : undefined
  const providerText = typeof payload.providerText === 'string' && payload.providerText.trim()
    ? payload.providerText.trim()
    : undefined
  const sourceFingerprint = typeof payload.sourceFingerprint === 'string'
    ? payload.sourceFingerprint.trim()
    : ''
  const generationInput = parseVoiceLineGenerationInput(payload.generationInput)
  if (!lineId) {
    throw new Error('VOICE_LINE task missing lineId')
  }
  if (!taskId) {
    throw new Error('VOICE_LINE task missing taskId')
  }
  if (!episodeId) {
    throw new Error('VOICE_LINE task missing episodeId')
  }
  if (
    job.data.targetType !== 'NovelPromotionVoiceLine'
    || payloadLineId !== lineId
    || payloadEpisodeId !== episodeId
    || !audioModel
    || !/^[a-f0-9]{64}$/.test(sourceFingerprint)
    || !generationInput
    || generationInput.line.id !== lineId
    || generationInput.line.episodeId !== episodeId
  ) {
    throw new Error('VOICE_LINE_TARGET_MISMATCH')
  }

  await assertTaskActive(job, 'voice_line_prepare')

  await reportTaskProgress(job, 20, { stage: 'generate_voice_submit', lineId })

  const generated = await generateVoiceLine({
    job,
    projectId: job.data.projectId,
    episodeId,
    lineId,
    taskId,
    userId: job.data.userId,
    audioModel,
    providerText,
    sourceFingerprint,
    generationInput,
    checkCancelled: async (stage) => await assertTaskActive(job, stage),
  })

  await reportTaskProgress(job, 95, { stage: 'generate_voice_persist', lineId })

  return generated
}

async function processVoiceTask(job: Job<TaskJobData>) {
  enforceVoiceDesignConsentBoundary(job.data.type)

  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.VOICE_LINE:
      return await handleVoiceLineTask(job)
    case TASK_TYPE.VOICE_DESIGN:
    case TASK_TYPE.ASSET_HUB_VOICE_DESIGN:
      return await handleVoiceDesignTask(job)
    case TASK_TYPE.CANVAS_TTS:
      return await handleCanvasTtsTask(job)
    default:
      throw new Error(`Unsupported voice task type: ${job.data.type}`)
  }
}

export function createVoiceWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VOICE,
    async (job) => await withTaskLifecycle(
      job,
      processVoiceTask,
      job.data.type === TASK_TYPE.VOICE_LINE
        ? {
            completionClaim: async ({ result, billing }) =>
              await claimVoiceLineCompletion(job, result, billing),
            terminalReconcile: async () =>
              await reconcileVoiceLineTerminalState(job),
          }
        : undefined,
    ),
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_VOICE || '10', 10) || 10,
      settings: {
        backoffStrategy: rateLimitAwareBackoff,
      },
    },
  )
}
