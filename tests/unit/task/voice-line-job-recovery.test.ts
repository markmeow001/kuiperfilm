import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import {
  voiceLineGenerationFingerprint,
  type VoiceLineGenerationInput,
} from '@/lib/voice/voice-generation-scope'

const prismaMock = vi.hoisted(() => ({
  task: {
    updateMany: vi.fn(),
  },
}))
const queueMock = vi.hoisted(() => ({
  QUEUE_NAME: { VOICE: 'kuiper-voice' },
  addTaskJob: vi.fn(),
}))
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/queues', () => queueMock)
vi.mock('@/lib/logging/core', () => ({ createScopedLogger: vi.fn(() => loggerMock) }))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveTaskLocaleFromBody: vi.fn((payload: unknown) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const meta = (payload as { meta?: unknown }).meta
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
    return (meta as { locale?: unknown }).locale === 'zh' ? 'zh' : null
  }),
}))

import {
  isProtectedVoiceLineProviderHandoff,
  recoverMissingVoiceLineJob,
} from '@/lib/task/voice-line-job-recovery'

const billingInfo: Extract<TaskBillingInfo, { billable: true }> = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.VOICE_LINE,
  apiType: 'voice',
  model: 'voice-model',
  quantity: 8,
  unit: 'second',
  maxFrozenCost: 1,
  action: 'voice.generate',
  freezeId: 'freeze-1',
  modeSnapshot: 'ENFORCE',
  status: 'frozen',
}

const generationInput: VoiceLineGenerationInput = {
  line: {
    id: 'line-1',
    episodeId: 'episode-1',
    speaker: 'Ann',
    content: 'Hello',
    voicePresetId: 'preset-1',
    emotionPrompt: null,
    emotionStrength: 0.4,
    speakerVoices: null,
    audioUrl: null,
    audioMediaId: null,
    audioDuration: null,
  },
  source: {
    presetId: 'preset-1',
    kind: 'storage-key',
    value: 'voice-presets/preset-1.wav',
  },
}

const ATLAS_AUDIO_MODEL = 'atlascloud::bytedance/seed-audio-1.0'
const ATLAS_AUDIO_EXTERNAL_ID = 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1'
const LEGACY_FAL_AUDIO_MODEL = 'fal::fal-ai/index-tts-2/text-to-speech'
const LEGACY_FAL_AUDIO_EXTERNAL_ID = 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-1'

const sourceFingerprint = voiceLineGenerationFingerprint({
  ...generationInput,
  audioModel: ATLAS_AUDIO_MODEL,
})

const canvasBillingInfo: Extract<TaskBillingInfo, { billable: true }> = {
  ...billingInfo,
  taskType: TASK_TYPE.CANVAS_TTS,
  model: ATLAS_AUDIO_MODEL,
  quantity: 11,
  unit: 'character',
  action: 'canvas.tts',
}

function recoveryTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-voice-1',
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'NovelPromotionVoiceLine',
    targetId: 'line-1',
    status: TASK_STATUS.PROCESSING,
    externalId: ATLAS_AUDIO_EXTERNAL_ID,
    payload: {
      episodeId: 'episode-1',
      lineId: 'line-1',
      audioModel: ATLAS_AUDIO_MODEL,
      generationInput,
      sourceFingerprint,
      meta: { locale: 'zh' },
    },
    billingInfo,
    priority: 7,
    attempt: 2,
    maxAttempts: 5,
    heartbeatAt: new Date(0),
    updatedAt: new Date(1),
    ...overrides,
  }
}

function legacyFalRecoveryTask(overrides: Record<string, unknown> = {}) {
  return recoveryTask({
    externalId: LEGACY_FAL_AUDIO_EXTERNAL_ID,
    payload: {
      ...recoveryTask().payload,
      audioModel: LEGACY_FAL_AUDIO_MODEL,
      sourceFingerprint: voiceLineGenerationFingerprint({
        ...generationInput,
        audioModel: LEGACY_FAL_AUDIO_MODEL,
      }),
    },
    ...overrides,
  })
}

function canvasRecoveryTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-canvas-tts-1',
    userId: 'user-1',
    projectId: 'playground',
    episodeId: null,
    type: TASK_TYPE.CANVAS_TTS,
    targetType: 'canvas-tts',
    targetId: 'canvas-target-1',
    status: TASK_STATUS.PROCESSING,
    externalId: ATLAS_AUDIO_EXTERNAL_ID,
    payload: {
      text: '你好😀',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      strength: 0.4,
      audioModel: ATLAS_AUDIO_MODEL,
      providerText: '@audio1 你好😀',
      meta: { locale: 'zh' },
    },
    billingInfo: canvasBillingInfo,
    priority: 4,
    attempt: 1,
    maxAttempts: 5,
    heartbeatAt: new Date(0),
    updatedAt: new Date(1),
    ...overrides,
  }
}

describe('durable VoiceLine BullMQ job recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.updateMany.mockReset().mockResolvedValue({ count: 1 })
    queueMock.addTaskJob.mockReset().mockResolvedValue({ id: 'task-voice-1' })
  })

  it('[durable actual AtlasCloud id + missing job] -> [same Task job is rebuilt in resume-only state]', async () => {
    const task = recoveryTask()

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'requeued',
    })

    expect(queueMock.addTaskJob).toHaveBeenCalledWith({
      taskId: 'task-voice-1',
      type: TASK_TYPE.VOICE_LINE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-1',
      payload: task.payload,
      billingInfo,
      userId: 'user-1',
      trace: null,
      providerExternalId: task.externalId,
    }, {
      priority: 7,
      attempts: 3,
    })
    expect(prismaMock.task.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: 'task-voice-1',
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
        type: TASK_TYPE.VOICE_LINE,
        externalId: task.externalId,
        heartbeatAt: task.heartbeatAt,
        updatedAt: task.updatedAt,
      },
      data: { heartbeatAt: expect.any(Date) },
    })
    expect(prismaMock.task.updateMany.mock.calls[1]?.[0]).toMatchObject({
      where: {
        id: 'task-voice-1',
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
        externalId: task.externalId,
      },
      data: {
        enqueuedAt: expect.any(Date),
        lastEnqueueError: null,
      },
    })
  })

  it('[durable actual AtlasCloud id + canonical provider instance] -> [same Task job is rebuilt]', async () => {
    const audioModel = 'atlascloud:primary::bytedance/seed-audio-1.0'
    const task = recoveryTask({
      payload: {
        ...recoveryTask().payload,
        audioModel,
        sourceFingerprint: voiceLineGenerationFingerprint({
          ...generationInput,
          audioModel,
        }),
      },
    })

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'requeued',
    })
    expect(queueMock.addTaskJob).toHaveBeenCalledOnce()
  })

  it('[retired provider paid id + exact pinned endpoint] -> [quarantined, never requeued]', async () => {
    const task = legacyFalRecoveryTask()

    // Voice is AtlasCloud-only, so this handoff can no longer be rebuilt into
    // a runnable job. Requeueing it would hand a paid request to a worker that
    // rejects the pinned model, failing the task non-retryably and refunding a
    // request we cannot prove was rejected.
    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['Canvas Atlas failed job', canvasRecoveryTask(), 'failed'],
  ] as const)('[%s has a valid actual id] -> [rewrites and retries the same terminal BullMQ job]', async (_label, task, terminalState) => {
    const terminalJob = {
      id: task.id,
      queueName: 'kuiper-voice',
      data: { stale: true },
      updateData: vi.fn<(data: Record<string, unknown>) => Promise<void>>(async () => undefined),
      retry: vi.fn(async () => undefined),
    }

    await expect(recoverMissingVoiceLineJob(task, {
      job: terminalJob as never,
      terminalState,
    })).resolves.toEqual({
      protected: true,
      state: 'requeued',
    })

    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(terminalJob.updateData).toHaveBeenCalledWith({
      taskId: task.id,
      type: task.type,
      locale: 'zh',
      projectId: task.projectId,
      episodeId: task.episodeId,
      targetType: task.targetType,
      targetId: task.targetId,
      payload: task.payload,
      billingInfo: task.billingInfo,
      userId: task.userId,
      trace: null,
      providerExternalId: task.externalId,
    })
    const recoveredData = terminalJob.updateData.mock.calls[0]?.[0]
    expect(recoveredData?.payload).toBe(task.payload)
    expect(recoveredData?.providerExternalId).toBe(task.externalId)
    expect(terminalJob.retry).toHaveBeenCalledWith(terminalState)
  })

  it('[terminal retry acknowledgement is unknown] -> [keeps the same paid task protected and records a deferred retry]', async () => {
    const task = canvasRecoveryTask()
    const terminalJob = {
      id: task.id,
      queueName: 'kuiper-voice',
      data: {},
      updateData: vi.fn(async () => undefined),
      retry: vi.fn(async () => { throw new Error('redis retry ack lost') }),
    }

    await expect(recoverMissingVoiceLineJob(task, {
      job: terminalJob as never,
      terminalState: 'failed',
    })).resolves.toEqual({
      protected: true,
      state: 'deferred',
    })

    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany.mock.calls[1]?.[0]).toMatchObject({
      where: expect.objectContaining({ id: task.id, externalId: task.externalId }),
      data: {
        enqueueAttempts: { increment: 1 },
        lastEnqueueError: 'redis retry ack lost',
      },
    })
  })

  it.each([
    'ATLASCLOUD:AUDIO:CLAIM:123:owner',
    'malformed-nonempty-handoff',
  ])('[terminal Canvas handoff %s is not an actual prediction] -> [quarantines without mutating or retrying its job]', async (externalId) => {
    const task = canvasRecoveryTask({ externalId })
    const terminalJob = {
      id: task.id,
      queueName: 'kuiper-voice',
      data: {},
      updateData: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
    }

    await expect(recoverMissingVoiceLineJob(task, {
      job: terminalJob as never,
      terminalState: 'failed',
    })).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })

    expect(terminalJob.updateData).not.toHaveBeenCalled()
    expect(terminalJob.retry).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['different job id', 'task-foreign', 'kuiper-voice'],
    ['different queue', 'task-canvas-tts-1', 'kuiper-video'],
  ])('[terminal actual Atlas handoff belongs to %s] -> [quarantines without mutating either job or task]', async (_label, jobId, queueName) => {
    const task = canvasRecoveryTask()
    const terminalJob = {
      id: jobId,
      queueName,
      data: {},
      updateData: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
    }

    await expect(recoverMissingVoiceLineJob(task, {
      job: terminalJob as never,
      terminalState: 'failed',
    })).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })

    expect(terminalJob.updateData).not.toHaveBeenCalled()
    expect(terminalJob.retry).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[Canvas TTS has durable actual AtlasCloud id + missing job] -> [same Canvas job and payload are rebuilt resume-only]', async () => {
    const task = canvasRecoveryTask()

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'requeued',
    })

    expect(queueMock.addTaskJob).toHaveBeenCalledWith({
      taskId: task.id,
      type: TASK_TYPE.CANVAS_TTS,
      locale: 'zh',
      projectId: 'playground',
      episodeId: null,
      targetType: 'canvas-tts',
      targetId: 'canvas-target-1',
      payload: task.payload,
      billingInfo: canvasBillingInfo,
      userId: 'user-1',
      trace: null,
      providerExternalId: ATLAS_AUDIO_EXTERNAL_ID,
    }, {
      priority: 4,
      attempts: 4,
    })
    expect(prismaMock.task.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: task.id,
        type: TASK_TYPE.CANVAS_TTS,
        targetType: 'canvas-tts',
        targetId: 'canvas-target-1',
        episodeId: null,
        externalId: ATLAS_AUDIO_EXTERNAL_ID,
      },
      data: { heartbeatAt: expect.any(Date) },
    })
  })

  it.each([
    ['Atlas submit claim', 'ATLASCLOUD:AUDIO:CLAIM:123:owner'],
    ['malformed Atlas id', 'ATLASCLOUD:AUDIO:malformed-without-prediction-id'],
    ['legacy FAL actual id', LEGACY_FAL_AUDIO_EXTERNAL_ID],
    ['unknown nonempty id', 'UNKNOWN:PAID:req-1'],
  ])('[Canvas TTS has %s] -> [quarantines with zero lease and zero queue add]', async (_label, externalId) => {
    const task = canvasRecoveryTask({ externalId })

    expect(isProtectedVoiceLineProviderHandoff(task)).toBe(true)
    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[Canvas TTS pinned provider text is not canonical] -> [quarantines before queue recovery]', async () => {
    const task = canvasRecoveryTask({
      payload: {
        ...canvasRecoveryTask().payload,
        providerText: '@audio1 tampered',
      },
    })

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['different Atlas model', 'atlascloud::bytedance/another-audio-model', 'ATLASCLOUD:AUDIO:bytedance/another-audio-model:prediction-1'],
    ['foreign reference namespace', ATLAS_AUDIO_MODEL, ATLAS_AUDIO_EXTERNAL_ID],
  ])('[Canvas TTS has %s] -> [quarantines instead of rebuilding an unsafe job]', async (label, audioModel, externalId) => {
    const payload = {
      ...canvasRecoveryTask().payload,
      audioModel,
      ...(label === 'foreign reference namespace'
        ? { referenceAudioKey: 'voice/playground-ref/other-user/ref.wav' }
        : {}),
    }
    const task = canvasRecoveryTask({ payload, externalId })

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[durable audio model with non-canonical whitespace] -> [quarantine before lease or queue add]', async () => {
    const audioModel = ' atlascloud::bytedance/seed-audio-1.0 '
    const task = recoveryTask({
      payload: {
        ...recoveryTask().payload,
        audioModel,
        sourceFingerprint: voiceLineGenerationFingerprint({
          ...generationInput,
          audioModel,
        }),
      },
    })

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[legacy paid FAL id + non-canonical pinned model] -> [quarantine instead of drain]', async () => {
    const audioModel = ' fal::fal-ai/index-tts-2/text-to-speech '
    const task = legacyFalRecoveryTask({
      payload: {
        ...legacyFalRecoveryTask().payload,
        audioModel,
        sourceFingerprint: voiceLineGenerationFingerprint({
          ...generationInput,
          audioModel,
        }),
      },
    })

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[queue.add acknowledgement unknown] -> [keeps active handoff protected for watchdog retry]', async () => {
    queueMock.addTaskJob.mockRejectedValueOnce(new Error('redis ack lost'))
    const task = recoveryTask()

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'deferred',
    })

    expect(queueMock.addTaskJob).toHaveBeenCalledOnce()
    expect(prismaMock.task.updateMany.mock.calls[1]?.[0]).toMatchObject({
      where: {
        id: task.id,
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
        externalId: task.externalId,
      },
      data: {
        enqueueAttempts: { increment: 1 },
        lastEnqueueError: 'redis ack lost',
      },
    })
  })

  it.each([
    ['missing generation input', undefined],
    ['malformed generation input', { line: {}, source: {} }],
    ['foreign line tuple', {
      ...generationInput,
      line: { ...generationInput.line, id: 'line-foreign' },
    }],
    ['foreign episode tuple', {
      ...generationInput,
      line: { ...generationInput.line, episodeId: 'episode-foreign' },
    }],
  ])('[actual provider id + %s] -> [quarantine with 0 lease and 0 queue add]', async (_label, value) => {
    const task = recoveryTask({
      payload: {
        ...recoveryTask().payload,
        generationInput: value,
      },
    })

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })

    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[generation input fingerprint mismatch] -> [quarantine before lease or queue add]', async () => {
    const task = recoveryTask({
      payload: {
        ...recoveryTask().payload,
        sourceFingerprint: 'b'.repeat(64),
      },
    })

    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })

    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    'voice-model',
    'ark::voice-model',
    'atlascloud::',
    'AtlasCloud::bytedance/seed-audio-1.0',
  ])('[invalid or unsupported pinned model %s] -> [quarantine before queue add]', async (audioModel) => {
    const task = recoveryTask({
      payload: {
        ...recoveryTask().payload,
        audioModel,
        sourceFingerprint: voiceLineGenerationFingerprint({
          ...generationInput,
          audioModel,
        }),
      },
    })

    expect(parseModelKeyStrict(audioModel)?.provider).not.toBe('atlascloud')
    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'Atlas external model differs from pinned model',
      task: recoveryTask({
        externalId: 'ATLASCLOUD:AUDIO:bytedance/another-audio-model:prediction-1',
      }),
    },
    {
      label: 'legacy FAL external endpoint differs from pinned endpoint',
      task: legacyFalRecoveryTask({
        externalId: 'FAL:VOICE:fal-ai/another-voice-model:req-1',
      }),
    },
    {
      label: 'Atlas external id paired with a FAL pinned model',
      task: recoveryTask({
        payload: legacyFalRecoveryTask().payload,
      }),
    },
    {
      label: 'FAL external id paired with an AtlasCloud pinned model',
      task: recoveryTask({
        externalId: LEGACY_FAL_AUDIO_EXTERNAL_ID,
      }),
    },
  ])('[$label] -> [quarantine instead of provider fallback or new submit]', async ({ task }) => {
    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    'ATLASCLOUD:AUDIO:CLAIM:123:owner',
    'ATLASCLOUD:AUDIO:malformed-without-prediction-id',
    ' ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1 ',
    'FAL:VOICE:CLAIM:123:owner',
    'FAL:VOICE:malformed-without-request-id',
    'SOME_OTHER_PAID_PROVIDER:req-1',
  ])('[unresolvable provider handoff %s] -> [quarantine with 0 queue add]', async (externalId) => {
    const task = recoveryTask({ externalId })

    expect(isProtectedVoiceLineProviderHandoff(task)).toBe(true)
    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: true,
      state: 'quarantined',
    })

    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[recovery lease loses active CAS] -> [0 queue add and no lifecycle mutation]', async () => {
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(recoverMissingVoiceLineJob(recoveryTask())).resolves.toEqual({
      protected: true,
      state: 'lost_race',
    })

    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).toHaveBeenCalledOnce()
  })

  it('[ordinary task with no provider handoff] -> [not applicable]', async () => {
    const task = recoveryTask({ externalId: null })

    expect(isProtectedVoiceLineProviderHandoff(task)).toBe(false)
    await expect(recoverMissingVoiceLineJob(task)).resolves.toEqual({
      protected: false,
      state: 'not_applicable',
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
  })
})
