import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}))
const rollbackMock = vi.hoisted(() => vi.fn())
const publishMock = vi.hoisted(() => vi.fn())
const recoveryMock = vi.hoisted(() => ({ recoverMissingVoiceLineJob: vi.fn() }))
const queuesMock = vi.hoisted(() => ({
  imageQueue: { getJob: vi.fn() },
  videoQueue: { getJob: vi.fn() },
  voiceQueue: { getJob: vi.fn() },
  textQueue: { getJob: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/service', () => ({ rollbackTaskBillingForTask: rollbackMock }))
vi.mock('@/lib/task/publisher', () => ({ publishTaskEvent: publishMock }))
vi.mock('@/lib/billing', () => ({ settleTaskBilling: vi.fn() }))
vi.mock('@/lib/task/voice-line-job-recovery', () => recoveryMock)
vi.mock('@/lib/task/queues', () => queuesMock)
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

import { reconcileActiveTasks } from '@/lib/task/reconcile'

function orphan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-orphan-voice',
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'NovelPromotionVoiceLine',
    targetId: 'line-1',
    status: TASK_STATUS.PROCESSING,
    externalId: 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-1',
    payload: {
      episodeId: 'episode-1',
      lineId: 'line-1',
      audioModel: 'voice-model',
      sourceFingerprint: 'a'.repeat(64),
      meta: { locale: 'zh' },
    },
    billingInfo: { billable: false },
    priority: 0,
    attempt: 1,
    maxAttempts: 5,
    heartbeatAt: new Date(0),
    updatedAt: new Date(Date.now() - 120_000),
    ...overrides,
  }
}

describe('watchdog durable VoiceLine orphan recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([orphan()])
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    rollbackMock.mockResolvedValue({ attempted: true, rolledBack: true, billingInfo: null })
    publishMock.mockResolvedValue({})
    for (const queue of Object.values(queuesMock)) {
      queue.getJob.mockResolvedValue(null)
    }
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValue({
      protected: true,
      state: 'requeued',
    })
  })

  it('[all queues authoritatively miss actual-id task] -> [recover same task; 0 fail/refund/event]', async () => {
    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-orphan-voice',
      externalId: 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-1',
      type: TASK_TYPE.VOICE_LINE,
    }))
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('[requeue acknowledgement unknown] -> [keeps Task protected for next watchdog pass]', async () => {
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: true,
      state: 'deferred',
    })

    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('[claim/malformed handoff] -> [quarantine with 0 orphan failure]', async () => {
    const claimed = orphan({ externalId: 'FAL:VOICE:CLAIM:123:owner' })
    prismaMock.task.findMany.mockResolvedValueOnce([claimed])
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: true,
      state: 'quarantined',
    })

    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(claimed)
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
  })

  it('[terminal VoiceLine job with valid legacy FAL actual id] -> [retries exact same job without fail/refund/clear dedupe]', async () => {
    const externalId = 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-terminal'
    const task = orphan({ externalId })
    const terminalJob = {
      id: task.id,
      queueName: 'kuiper-voice',
      getState: vi.fn().mockResolvedValue('failed'),
      updateData: vi.fn(),
      retry: vi.fn(),
    }
    prismaMock.task.findMany.mockResolvedValueOnce([task])
    queuesMock.voiceQueue.getJob.mockResolvedValueOnce(terminalJob)

    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(task, {
      job: terminalJob,
      terminalState: 'failed',
    })
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('[terminal BullMQ job with submit claim] -> [quarantines; 0 fail/refund/clear dedupe]', async () => {
    const externalId = 'FAL:VOICE:CLAIM:123:owner'
    const task = orphan({
      externalId,
      updatedAt: new Date(Date.now() - 180_000),
    })
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: true,
      state: 'quarantined',
    })
    prismaMock.task.findMany.mockResolvedValueOnce([task])
    queuesMock.voiceQueue.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('failed'),
    })

    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(
      expect.objectContaining({ externalId }),
      expect.objectContaining({ terminalState: 'failed' }),
    )
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('[ordinary missing task without handoff] -> [retains existing orphan terminal behavior]', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([orphan({ externalId: null })])
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: false,
      state: 'not_applicable',
    })

    await expect(reconcileActiveTasks()).resolves.toEqual(['task-orphan-voice'])

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: TASK_STATUS.FAILED,
        errorCode: 'RECONCILE_ORPHAN',
        dedupeKey: null,
      }),
    }))
    expect(rollbackMock).toHaveBeenCalledWith({ taskId: 'task-orphan-voice' })
  })

  it('[missing Canvas TTS job has actual Atlas handoff] -> [recovers same task with zero fail/refund]', async () => {
    const canvas = orphan({
      id: 'task-canvas-tts',
      projectId: 'playground',
      episodeId: null,
      type: TASK_TYPE.CANVAS_TTS,
      targetType: 'canvas-tts',
      targetId: 'canvas-target-1',
      externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1',
    })
    prismaMock.task.findMany.mockResolvedValueOnce([canvas])

    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(canvas)
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
  })

  it('[terminal Canvas TTS job has valid Atlas prediction] -> [retries exact same job without fail/refund/dedupe clear]', async () => {
    const externalId = 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-terminal'
    const task = orphan({
      id: 'task-canvas-tts',
      projectId: 'playground',
      episodeId: null,
      type: TASK_TYPE.CANVAS_TTS,
      targetType: 'canvas-tts',
      targetId: 'canvas-target-1',
      externalId,
      updatedAt: new Date(Date.now() - 180_000),
    })
    const terminalJob = {
      id: task.id,
      queueName: 'kuiper-voice',
      getState: vi.fn().mockResolvedValue('failed'),
      updateData: vi.fn(),
      retry: vi.fn(),
    }
    prismaMock.task.findMany.mockResolvedValueOnce([task])
    queuesMock.voiceQueue.getJob.mockResolvedValueOnce(terminalJob)

    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(task, {
      job: terminalJob,
      terminalState: 'failed',
    })
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it.each([
    'ATLASCLOUD:AUDIO:CLAIM:123:owner',
    'malformed-nonempty-handoff',
  ])('[terminal Canvas TTS job retains unresolved handoff %s] -> [quarantines with zero fail/refund/dedupe clear]', async (externalId) => {
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: true,
      state: 'quarantined',
    })
    prismaMock.task.findMany.mockResolvedValueOnce([orphan({
      id: 'task-canvas-tts',
      projectId: 'playground',
      episodeId: null,
      type: TASK_TYPE.CANVAS_TTS,
      targetType: 'canvas-tts',
      targetId: 'canvas-target-1',
      externalId,
      updatedAt: new Date(Date.now() - 180_000),
    })])
    queuesMock.voiceQueue.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('failed'),
    })

    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(
      expect.objectContaining({ externalId }),
      expect.objectContaining({ terminalState: 'failed' }),
    )
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('[watchdog Canvas snapshot had no handoff, Atlas claim wins before orphan CAS] -> [conditional CAS loses with zero refund/event]', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([orphan({
      id: 'task-canvas-tts',
      projectId: 'playground',
      episodeId: null,
      type: TASK_TYPE.CANVAS_TTS,
      targetType: 'canvas-tts',
      targetId: 'canvas-target-1',
      externalId: null,
    })])
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: false,
      state: 'not_applicable',
    })
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ externalId: null }, { externalId: '' }],
      }),
    }))
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('[watchdog snapshot had no handoff, provider claim wins before orphan CAS] -> [0 fail/refund/event]', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([orphan({ externalId: null })])
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: false,
      state: 'not_applicable',
    })
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(reconcileActiveTasks()).resolves.toEqual([])

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ externalId: null }, { externalId: '' }],
      }),
    }))
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })
})
