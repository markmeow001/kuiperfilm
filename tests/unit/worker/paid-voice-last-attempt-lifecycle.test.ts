import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnrecoverableError, type Job } from 'bullmq'
import { TaskTerminatedError } from '@/lib/task/errors'
import { TASK_TYPE, type TaskBillingInfo, type TaskJobData } from '@/lib/task/types'

const taskServiceMock = vi.hoisted(() => ({
  claimTaskExternalId: vi.fn(),
  getPaidVoiceProviderHandoffSnapshot: vi.fn(),
  persistTaskExternalIdOrThrow: vi.fn(),
  replaceTaskExternalIdOrThrow: vi.fn(),
  rollbackTaskBillingForTask: vi.fn(),
  touchTaskHeartbeat: vi.fn(),
  tryMarkTaskCompleted: vi.fn(),
  tryMarkPaidVoiceTaskFailedBeforeProviderHandoff: vi.fn(),
  tryMarkTaskFailed: vi.fn(),
  tryMarkPaidVoiceProviderTerminalFailure: vi.fn(),
  tryMarkTaskProcessing: vi.fn(),
  tryUpdateTaskProgress: vi.fn(),
  updateTaskBillingInfo: vi.fn(),
}))

const workerUtilsMock = vi.hoisted(() => ({
  getTaskExistingExternalId: vi.fn(),
}))

const publisherMock = vi.hoisted(() => ({
  publishTaskEvent: vi.fn(),
  publishTaskStreamEvent: vi.fn(),
}))

const billingMock = vi.hoisted(() => ({ settleTaskBilling: vi.fn() }))
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/workers/utils', () => workerUtilsMock)
vi.mock('@/lib/task/provider-submit-claim', () => ({
  releaseRejectedProviderSubmitClaimOrThrow: vi.fn(),
}))
vi.mock('@/lib/task/publisher', () => publisherMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/task/queues', () => ({ rateLimitAwareBackoff: vi.fn(() => 1_000) }))
vi.mock('@/lib/billing/runtime-usage', () => ({
  withTextUsageCollection: vi.fn(async <T>(operation: () => Promise<T>) => ({
    result: await operation(),
    textUsage: [],
  })),
}))
vi.mock('@/lib/logging/core', () => ({ createScopedLogger: vi.fn(() => loggerMock) }))
vi.mock('@/lib/logging/file-writer', () => ({ onProjectNameAvailable: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { project: { findUnique: vi.fn(async () => null) } },
}))

import {
  ATLASCLOUD_SEED_AUDIO_MODEL_ID,
  resolveDurableAtlasCloudVoiceAudioUrl,
} from '@/lib/voice/atlascloud-voice-provider'
import { withTaskLifecycle } from '@/lib/workers/shared'

const frozenBilling: Extract<TaskBillingInfo, { billable: true }> = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.VOICE_LINE,
  apiType: 'voice',
  model: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
  quantity: 5,
  unit: 'character',
  maxFrozenCost: 0.000075,
  action: 'voice.generate',
  freezeId: 'freeze-paid-atlas',
  modeSnapshot: 'ENFORCE',
  status: 'frozen',
}

function createFinalAttemptJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-paid-atlas-final',
      type: TASK_TYPE.VOICE_LINE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-1',
      userId: 'user-1',
      billingInfo: { ...frozenBilling },
      payload: {},
    },
    queueName: 'voice',
    opts: { attempts: 5 },
    attemptsMade: 4,
  } as unknown as Job<TaskJobData>
}

function createPaidJob(params: {
  type: typeof TASK_TYPE.VOICE_LINE | typeof TASK_TYPE.CANVAS_TTS
  attemptsMade?: number
}): Job<TaskJobData> {
  const targetType = params.type === TASK_TYPE.VOICE_LINE
    ? 'NovelPromotionVoiceLine'
    : 'canvas-tts'
  return {
    ...createFinalAttemptJob(),
    data: {
      ...createFinalAttemptJob().data,
      type: params.type,
      targetType,
      targetId: params.type === TASK_TYPE.VOICE_LINE ? 'line-1' : 'canvas-request-1',
    },
    attemptsMade: params.attemptsMade ?? 4,
  } as unknown as Job<TaskJobData>
}

describe('paid voice final-attempt lifecycle quarantine', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    taskServiceMock.tryMarkTaskProcessing.mockResolvedValue(true)
    taskServiceMock.touchTaskHeartbeat.mockResolvedValue(true)
    taskServiceMock.tryMarkTaskCompleted.mockResolvedValue(true)
    taskServiceMock.tryMarkPaidVoiceTaskFailedBeforeProviderHandoff.mockResolvedValue(true)
    taskServiceMock.tryMarkTaskFailed.mockResolvedValue(true)
    taskServiceMock.tryMarkPaidVoiceProviderTerminalFailure.mockResolvedValue(true)
    taskServiceMock.tryUpdateTaskProgress.mockResolvedValue(true)
    taskServiceMock.rollbackTaskBillingForTask.mockResolvedValue({
      attempted: true,
      rolledBack: true,
      billingInfo: { ...frozenBilling, status: 'rolled_back' },
    })
    taskServiceMock.getPaidVoiceProviderHandoffSnapshot.mockResolvedValue({
      status: 'processing',
      progress: 57,
      handoff: {
        kind: 'actual',
        provider: 'atlascloud',
        externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-paid-final',
      },
    })
    publisherMock.publishTaskEvent.mockResolvedValue({})
    publisherMock.publishTaskStreamEvent.mockResolvedValue({})
    workerUtilsMock.getTaskExistingExternalId.mockResolvedValue(
      'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-paid-final',
    )
  })

  it('[Atlas paid prediction status transport fails on final attempt] -> [worker keeps task/freeze active with zero refund, failed event, or provider submit]', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new TypeError('status gateway unavailable'),
    )
    const terminalReconcile = vi.fn(async () => 'active')
    const job = createFinalAttemptJob()

    await expect(withTaskLifecycle(
      job,
      async () => {
        await resolveDurableAtlasCloudVoiceAudioUrl({
          job,
          modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
          apiKey: 'atlas-secret',
        })
      },
      { terminalReconcile },
    )).rejects.toBeInstanceOf(UnrecoverableError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.atlascloud.ai/api/v1/model/prediction/prediction-paid-final',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(taskServiceMock.claimTaskExternalId).not.toHaveBeenCalled()
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(billingMock.settleTaskBilling).not.toHaveBeenCalled()
    expect(taskServiceMock.updateTaskBillingInfo).not.toHaveBeenCalled()
    expect(publisherMock.publishTaskEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.failed' }),
    )
    expect(terminalReconcile).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      type: TASK_TYPE.VOICE_LINE,
      message: 'VOICE_LINE_UPLOAD_RECONCILIATION_REQUIRED',
    },
    {
      type: TASK_TYPE.CANVAS_TTS,
      message: 'CANVAS_TTS_OUTPUT_UPLOAD_FAILED',
    },
  ])('[$type actual provider id + final retryable downstream failure] -> [quarantines active task/freeze with an auditable marker]', async ({ type, message }) => {
    const terminalReconcile = vi.fn(async () => 'active')
    const job = createPaidJob({ type })

    await expect(withTaskLifecycle(
      job,
      async () => {
        throw Object.assign(new Error(message), {
          code: 'EXTERNAL_ERROR',
          provider: 'cos',
        })
      },
      { terminalReconcile },
    )).rejects.toBeInstanceOf(UnrecoverableError)

    expect(taskServiceMock.tryUpdateTaskProgress).toHaveBeenCalledWith(
      job.data.taskId,
      57,
      expect.objectContaining({
        paidVoiceLifecycle: expect.objectContaining({
          state: 'quarantined',
          reasonCode: 'PAID_VOICE_DOWNSTREAM_OUTCOME_UNRESOLVED',
          failedAttempt: 5,
          maxAttempts: 5,
          provider: 'atlascloud',
          providerExternalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-paid-final',
        }),
      }),
    )
    expect(taskServiceMock.tryMarkPaidVoiceProviderTerminalFailure).not.toHaveBeenCalled()
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(terminalReconcile).toHaveBeenCalledTimes(1)
  })

  it('[actual provider id + retryable downstream failure with another attempt] -> [lets BullMQ retry the exact task without terminal mutation]', async () => {
    const job = createPaidJob({ type: TASK_TYPE.VOICE_LINE, attemptsMade: 2 })
    const original = Object.assign(new Error('VOICE_LINE_PROVIDER_OUTPUT_FETCH_RETRYABLE'), {
      code: 'EXTERNAL_ERROR',
    })

    await expect(withTaskLifecycle(job, async () => {
      throw original
    })).rejects.toBe(original)

    expect(taskServiceMock.getPaidVoiceProviderHandoffSnapshot).not.toHaveBeenCalled()
    expect(taskServiceMock.tryUpdateTaskProgress).not.toHaveBeenCalled()
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
  })

  it.each([
    {
      terminalStatus: 'failed' as const,
      thrown: Object.assign(new Error('ATLAS_AUDIO_PROVIDER_REQUEST_FAILED'), {
        code: 'INVALID_PARAMS',
        provider: 'atlascloud',
      }),
    },
    {
      terminalStatus: 'timeout' as const,
      thrown: Object.assign(
        new TaskTerminatedError('task-paid-atlas-final', 'ATLAS_AUDIO_PROVIDER_TIMEOUT_QUARANTINED'),
        {
          cause: Object.assign(new Error('ATLAS_AUDIO_PROVIDER_REQUEST_TIMEOUT'), {
            code: 'GENERATION_TIMEOUT',
            provider: 'atlascloud',
          }),
        },
      ),
    },
  ])('[Atlas explicitly reports $terminalStatus] -> [marks a distinct terminal failure and refunds exactly once]', async ({ terminalStatus, thrown }) => {
    const job = createPaidJob({ type: TASK_TYPE.VOICE_LINE })

    await expect(withTaskLifecycle(job, async () => {
      throw thrown
    })).rejects.toBeInstanceOf(UnrecoverableError)

    expect(taskServiceMock.tryMarkPaidVoiceProviderTerminalFailure).toHaveBeenCalledWith({
      taskId: job.data.taskId,
      expectedTaskType: TASK_TYPE.VOICE_LINE,
      externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-paid-final',
      terminalStatus,
      errorMessage: terminalStatus === 'failed'
        ? 'ATLAS_AUDIO_PROVIDER_REQUEST_FAILED'
        : 'ATLAS_AUDIO_PROVIDER_REQUEST_TIMEOUT',
    })
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(taskServiceMock.rollbackTaskBillingForTask).toHaveBeenCalledWith({
      taskId: job.data.taskId,
      billingInfo: frozenBilling,
    })
    expect(publisherMock.publishTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.failed' }),
    )
    expect(taskServiceMock.tryUpdateTaskProgress).not.toHaveBeenCalled()
  })

  it('[legacy FAL returns an undocumented status-shaped error] -> [does not classify it as an explicit provider terminal negative]', async () => {
    const job = createPaidJob({ type: TASK_TYPE.VOICE_LINE })
    const thrown = Object.assign(new Error('VOICE_PROVIDER_REQUEST_FAILED'), {
      code: 'INVALID_PARAMS',
      provider: 'fal',
    })

    await expect(withTaskLifecycle(job, async () => {
      throw thrown
    })).rejects.toBeInstanceOf(UnrecoverableError)

    expect(taskServiceMock.tryMarkPaidVoiceProviderTerminalFailure).not.toHaveBeenCalled()
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(publisherMock.publishTaskEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.failed' }),
    )
  })

  it('[local poll deadline has the same outer quarantine but no explicit provider terminal signal] -> [does not refund or release dedupe]', async () => {
    const job = createPaidJob({ type: TASK_TYPE.VOICE_LINE })
    const localDeadline = Object.assign(
      new TaskTerminatedError(job.data.taskId, 'ATLAS_AUDIO_PROVIDER_TIMEOUT_QUARANTINED'),
      {
        cause: Object.assign(new Error('ATLAS_AUDIO_PROVIDER_POLL_TIMEOUT'), {
          code: 'GENERATION_TIMEOUT',
          provider: 'atlascloud',
        }),
      },
    )

    await expect(withTaskLifecycle(job, async () => {
      throw localDeadline
    })).rejects.toBeInstanceOf(UnrecoverableError)

    expect(taskServiceMock.tryMarkPaidVoiceProviderTerminalFailure).not.toHaveBeenCalled()
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(taskServiceMock.tryUpdateTaskProgress).toHaveBeenCalledWith(
      job.data.taskId,
      57,
      expect.objectContaining({
        paidVoiceLifecycle: expect.objectContaining({
          state: 'quarantined',
          reasonCode: 'ATLAS_AUDIO_PROVIDER_TIMEOUT_QUARANTINED',
        }),
      }),
    )
  })

  it('[inspection sees no handoff, but provider claim wins before generic failure CAS] -> [rereads actual handoff and performs zero fail/refund]', async () => {
    const job = createPaidJob({ type: TASK_TYPE.VOICE_LINE })
    const terminalReconcile = vi.fn(async () => 'active')
    taskServiceMock.getPaidVoiceProviderHandoffSnapshot
      .mockResolvedValueOnce({
        status: 'processing',
        progress: 18,
        handoff: { kind: 'none', externalId: null },
      })
      .mockResolvedValueOnce({
        status: 'processing',
        progress: 19,
        handoff: {
          kind: 'actual',
          provider: 'atlascloud',
          externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-race-winner',
        },
      })
    taskServiceMock.tryMarkPaidVoiceTaskFailedBeforeProviderHandoff.mockResolvedValueOnce(false)

    await expect(withTaskLifecycle(job, async () => {
      throw Object.assign(new Error('invalid local voice input'), { code: 'INVALID_PARAMS' })
    }, { terminalReconcile })).rejects.toBeInstanceOf(UnrecoverableError)

    expect(taskServiceMock.tryMarkPaidVoiceTaskFailedBeforeProviderHandoff).toHaveBeenCalledWith({
      taskId: job.data.taskId,
      expectedTaskType: TASK_TYPE.VOICE_LINE,
      errorCode: 'INVALID_PARAMS',
      errorMessage: 'invalid local voice input',
    })
    expect(taskServiceMock.getPaidVoiceProviderHandoffSnapshot).toHaveBeenCalledTimes(2)
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(taskServiceMock.tryUpdateTaskProgress).toHaveBeenCalledWith(
      job.data.taskId,
      19,
      expect.objectContaining({
        paidVoiceLifecycle: expect.objectContaining({
          providerExternalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-race-winner',
        }),
      }),
    )
    expect(terminalReconcile).toHaveBeenCalledTimes(1)
  })
})
