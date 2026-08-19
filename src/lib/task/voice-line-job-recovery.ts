import type { Job } from 'bullmq'
import { createScopedLogger } from '@/lib/logging/core'
import { getProviderKey } from '@/lib/api-config'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { prisma } from '@/lib/prisma'
import { canvasTtsRecoveryJobData } from '@/lib/task/canvas-tts-job-recovery'
import { addTaskJob, QUEUE_NAME } from '@/lib/task/queues'
import { resolveTaskLocaleFromBody } from '@/lib/task/resolve-locale'
import {
  TASK_STATUS,
  TASK_TYPE,
  type TaskBillingInfo,
  type TaskJobData,
} from '@/lib/task/types'
import { isProtectedVoiceLineProviderHandoff } from '@/lib/task/voice-line-recovery-policy'
import {
  parseVoiceLineGenerationInput,
  voiceLineGenerationFingerprint,
} from '@/lib/voice/voice-generation-scope'

export { isProtectedVoiceLineProviderHandoff } from '@/lib/task/voice-line-recovery-policy'

const ACTIVE_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] as const
const ATLASCLOUD_AUDIO_PREFIX = 'ATLASCLOUD:AUDIO:'
const ATLASCLOUD_AUDIO_CLAIM_PREFIX = 'ATLASCLOUD:AUDIO:CLAIM:'
const FAL_VOICE_PREFIX = 'FAL:VOICE:'
const FAL_VOICE_CLAIM_PREFIX = 'FAL:VOICE:CLAIM:'

type RecoverableVoiceProvider = 'atlascloud' | 'fal'

type ActualVoiceProviderHandoff = {
  provider: RecoverableVoiceProvider
  modelId: string
}

export type VoiceLineRecoveryTask = {
  id: string
  userId: string
  projectId: string
  episodeId: string | null
  type: string
  targetType: string
  targetId: string
  status: string
  externalId: string | null
  payload: unknown
  billingInfo: unknown
  priority: number
  attempt: number
  maxAttempts: number
  heartbeatAt: Date | null
  updatedAt: Date
}

export type VoiceLineJobRecoveryResult = {
  protected: boolean
  state: 'not_applicable' | 'requeued' | 'deferred' | 'quarantined' | 'lost_race'
}

export type TerminalVoiceJobRecovery = {
  job: Pick<Job<TaskJobData>, 'id' | 'queueName' | 'updateData' | 'retry'>
  terminalState: 'completed' | 'failed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseActualVoiceProviderHandoff(
  value: string,
): ActualVoiceProviderHandoff | null {
  let provider: RecoverableVoiceProvider
  let prefix: string
  if (
    value.startsWith(ATLASCLOUD_AUDIO_PREFIX)
    && !value.startsWith(ATLASCLOUD_AUDIO_CLAIM_PREFIX)
  ) {
    provider = 'atlascloud'
    prefix = ATLASCLOUD_AUDIO_PREFIX
  } else if (
    value.startsWith(FAL_VOICE_PREFIX)
    && !value.startsWith(FAL_VOICE_CLAIM_PREFIX)
  ) {
    // Resume-only compatibility for an already-paid FAL handoff. New voice
    // submissions are AtlasCloud-only; recovery never creates a provider id.
    provider = 'fal'
    prefix = FAL_VOICE_PREFIX
  } else {
    return null
  }

  const remainder = value.slice(prefix.length)
  const separator = remainder.lastIndexOf(':')
  if (separator <= 0) return null
  const modelId = remainder.slice(0, separator)
  const providerRequestId = remainder.slice(separator + 1)
  if (
    modelId.trim() !== modelId
    || providerRequestId.trim() !== providerRequestId
    || modelId.length === 0
    || providerRequestId.length === 0
  ) return null

  return { provider, modelId }
}

function taskBillingInfo(value: unknown): TaskBillingInfo | null | undefined {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.billable !== 'boolean') return undefined
  return value as TaskBillingInfo
}

function voiceLineRecoveryJobData(
  task: VoiceLineRecoveryTask,
  providerHandoff: ActualVoiceProviderHandoff,
): TaskJobData | null {
  if (
    task.status !== TASK_STATUS.QUEUED
    && task.status !== TASK_STATUS.PROCESSING
  ) return null
  if (
    task.targetType !== 'NovelPromotionVoiceLine'
    || !nonEmptyString(task.id)
    || !nonEmptyString(task.userId)
    || !nonEmptyString(task.projectId)
    || !nonEmptyString(task.episodeId)
    || !nonEmptyString(task.targetId)
    || !isRecord(task.payload)
  ) return null

  const payload = task.payload
  const locale = resolveTaskLocaleFromBody(payload)
  const billingInfo = taskBillingInfo(task.billingInfo)
  const audioModel = nonEmptyString(payload.audioModel) ? payload.audioModel : null
  const parsedAudioModel = parseModelKeyStrict(audioModel)
  const generationInput = parseVoiceLineGenerationInput(payload.generationInput)
  if (
    !locale
    || billingInfo === undefined
    || payload.episodeId !== task.episodeId
    || payload.lineId !== task.targetId
    || !audioModel
    || !parsedAudioModel
    || parsedAudioModel.modelKey !== audioModel
    || getProviderKey(parsedAudioModel.provider) !== providerHandoff.provider
    || parsedAudioModel.modelId !== providerHandoff.modelId
    || !generationInput
    || generationInput.line.id !== task.targetId
    || generationInput.line.episodeId !== task.episodeId
    || typeof payload.sourceFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.sourceFingerprint)
    || voiceLineGenerationFingerprint({
      ...generationInput,
      audioModel,
    }) !== payload.sourceFingerprint
  ) return null

  return {
    taskId: task.id,
    type: TASK_TYPE.VOICE_LINE,
    locale,
    projectId: task.projectId,
    episodeId: task.episodeId,
    targetType: task.targetType,
    targetId: task.targetId,
    payload,
    billingInfo,
    userId: task.userId,
    trace: null,
    providerExternalId: task.externalId,
  }
}

function recoveryJobData(
  task: VoiceLineRecoveryTask,
  providerHandoff: ActualVoiceProviderHandoff,
): TaskJobData | null {
  if (task.type === TASK_TYPE.VOICE_LINE) {
    return voiceLineRecoveryJobData(task, providerHandoff)
  }
  if (task.type === TASK_TYPE.CANVAS_TTS) {
    return canvasTtsRecoveryJobData(task, providerHandoff)
  }
  return null
}

function isVoiceProviderSubmitClaim(externalId: string): boolean {
  return externalId.startsWith(ATLASCLOUD_AUDIO_CLAIM_PREFIX)
    || externalId.startsWith(FAL_VOICE_CLAIM_PREFIX)
}

function exactActiveHandoffWhere(task: VoiceLineRecoveryTask, externalId: string) {
  return {
    id: task.id,
    userId: task.userId,
    projectId: task.projectId,
    episodeId: task.episodeId,
    status: { in: [...ACTIVE_STATUSES] },
    type: task.type,
    targetType: task.targetType,
    targetId: task.targetId,
    externalId,
  }
}

function recoveryLeaseWhere(task: VoiceLineRecoveryTask, externalId: string) {
  return {
    ...exactActiveHandoffWhere(task, externalId),
    heartbeatAt: task.heartbeatAt,
    updatedAt: task.updatedAt,
  }
}

export async function recoverMissingVoiceLineJob(
  task: VoiceLineRecoveryTask,
  terminal?: TerminalVoiceJobRecovery,
): Promise<VoiceLineJobRecoveryResult> {
  if (!isProtectedVoiceLineProviderHandoff(task)) {
    return { protected: false, state: 'not_applicable' }
  }

  const externalId = task.externalId!
  const providerHandoff = parseActualVoiceProviderHandoff(externalId)
  const reconstructedJobData = providerHandoff
    ? recoveryJobData({ ...task, externalId }, providerHandoff)
    : null
  const terminalJobMatches = !terminal
    || (terminal.job.id === task.id && terminal.job.queueName === QUEUE_NAME.VOICE)
  const jobData = terminalJobMatches ? reconstructedJobData : null
  const logger = createScopedLogger({
    module: 'task.voice-line-job-recovery',
    action: 'task.voice_line.queue_recovery',
    taskId: task.id,
    projectId: task.projectId,
    userId: task.userId,
  })

  if (!jobData) {
    logger.error({
      action: 'task.voice_line.queue_recovery_quarantined',
      message: 'Voice provider handoff cannot be safely reconstructed; manual reconciliation required',
      errorCode: 'VOICE_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED',
      retryable: false,
      details: {
        externalIdKind: isVoiceProviderSubmitClaim(externalId)
          ? 'submit_claim'
          : 'unrecognized_or_invalid',
      },
    })
    return { protected: true, state: 'quarantined' }
  }

  // This active-only write is a bounded recovery lease. Besides excluding a
  // cancellation/completion race, its fresh heartbeat keeps the generic stale
  // sweeper from refunding the paid handoff while queue.add is ambiguous.
  const lease = await prisma.task.updateMany({
    where: recoveryLeaseWhere(task, externalId),
    data: { heartbeatAt: new Date() },
  })
  if (lease.count !== 1) {
    return { protected: true, state: 'lost_race' }
  }

  try {
    if (terminal) {
      // Keep the original BullMQ job id and replace only its reconstructable
      // data snapshot. providerExternalId forces the worker onto resume/poll;
      // this path never owns or performs a new provider submission.
      await terminal.job.updateData(jobData)
      await terminal.job.retry(terminal.terminalState)
    } else {
      const priority = Number.isFinite(task.priority) ? Math.max(0, Math.floor(task.priority)) : 0
      const maxAttempts = Number.isFinite(task.maxAttempts) ? Math.max(1, Math.floor(task.maxAttempts)) : 5
      const attemptsMade = Number.isFinite(task.attempt) ? Math.max(0, Math.floor(task.attempt)) : 0
      const attempts = Math.max(1, maxAttempts - attemptsMade)
      await addTaskJob(jobData, { priority, attempts })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await prisma.task.updateMany({
        where: exactActiveHandoffWhere(task, externalId),
        data: {
          enqueueAttempts: { increment: 1 },
          lastEnqueueError: (message || 'voice queue recovery acknowledgement unknown').slice(0, 500),
        },
      })
    } catch (markerError) {
      logger.error({
        action: 'task.voice_line.queue_recovery_marker_failed',
        message: 'Queue recovery outcome and diagnostic marker are both unknown',
        retryable: true,
        error: markerError instanceof Error ? markerError.message : String(markerError),
      })
    }
    logger.warn({
      action: 'task.voice_line.queue_recovery_deferred',
      message: 'Queue recovery acknowledgement unknown; durable provider handoff remains protected',
      retryable: true,
      error: message,
    })
    return { protected: true, state: 'deferred' }
  }

  try {
    await prisma.task.updateMany({
      where: exactActiveHandoffWhere(task, externalId),
      data: {
        enqueuedAt: new Date(),
        lastEnqueueError: null,
      },
    })
  } catch (error) {
    // The idempotent BullMQ job already exists under taskId. A diagnostic DB
    // marker failure must not turn this back into an orphan/refund path.
    logger.warn({
      action: 'task.voice_line.queue_recovery_enqueued_marker_failed',
      message: 'Recovered BullMQ job but failed to persist enqueued marker',
      retryable: true,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  logger.info({
    action: 'task.voice_line.queue_recovered',
    message: terminal
      ? 'Retried terminal voice job from durable provider handoff'
      : 'Rebuilt missing voice job from durable provider handoff',
    details: {
      recoveryKind: terminal ? 'terminal_retry' : 'missing_rebuild',
    },
  })
  return { protected: true, state: 'requeued' }
}
