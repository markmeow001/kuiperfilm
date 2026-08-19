import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type CreateTaskInput, type TaskBillingInfo } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}))
const billingMock = vi.hoisted(() => ({ rollbackTaskBilling: vi.fn() }))
const recoveryMock = vi.hoisted(() => ({ recoverMissingVoiceLineJob: vi.fn() }))
const reconcileMock = vi.hoisted(() => ({ isJobAlive: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async <T>(operation: () => Promise<T>) => await operation()),
}))
vi.mock('@/i18n/routing', () => ({ locales: ['zh', 'en'] }))
vi.mock('@/lib/task/reconcile', () => reconcileMock)
vi.mock('@/lib/task/voice-line-job-recovery', () => recoveryMock)

import { cancelTask, createTask, sweepStaleTasks } from '@/lib/task/service'

const billingInfo: Extract<TaskBillingInfo, { billable: true }> = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.CANVAS_TTS,
  apiType: 'voice',
  model: 'atlascloud::bytedance/seed-audio-1.0',
  quantity: 11,
  unit: 'character',
  maxFrozenCost: 1,
  action: 'canvas.tts',
  freezeId: 'freeze-canvas-1',
  modeSnapshot: 'ENFORCE',
  status: 'frozen',
}

function activeCanvasTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-canvas-1',
    userId: 'user-1',
    projectId: 'playground',
    episodeId: null,
    type: TASK_TYPE.CANVAS_TTS,
    targetType: 'canvas-tts',
    targetId: 'canvas-target-1',
    status: TASK_STATUS.PROCESSING,
    progress: 45,
    attempt: 1,
    maxAttempts: 5,
    priority: 0,
    dedupeKey: 'canvas_tts:canvas-target-1',
    externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1',
    payload: {
      text: '你好',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      strength: 0.4,
      audioModel: 'atlascloud::bytedance/seed-audio-1.0',
      providerText: '@audio1 你好',
      meta: { locale: 'zh' },
    },
    billingInfo,
    heartbeatAt: new Date(0),
    startedAt: new Date(0),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

function createInput(): CreateTaskInput {
  return {
    userId: 'user-1',
    projectId: 'playground',
    type: TASK_TYPE.CANVAS_TTS,
    targetType: 'canvas-tts',
    targetId: 'canvas-target-1',
    payload: {
      ...activeCanvasTask().payload,
      meta: { locale: 'zh' },
    },
    dedupeKey: 'canvas_tts:canvas-target-1',
    billingInfo,
  }
}

describe('Canvas TTS paid handoff lifecycle protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.task.findUnique.mockResolvedValue(activeCanvasTask())
    prismaMock.task.update.mockResolvedValue({})
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.task.create.mockResolvedValue({ id: 'task-new', status: TASK_STATUS.QUEUED })
    billingMock.rollbackTaskBilling.mockResolvedValue({ ...billingInfo, status: 'rolled_back' })
    reconcileMock.isJobAlive.mockResolvedValue(false)
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValue({
      protected: true,
      state: 'requeued',
    })
  })

  it('[active Canvas task lost its queue job after Atlas acceptance] -> [reuses and recovers same task with zero refund/replacement]', async () => {
    const existing = activeCanvasTask()
    prismaMock.task.findFirst.mockResolvedValueOnce(existing)

    await expect(createTask(createInput())).resolves.toEqual({ task: existing, deduped: true })

    expect(reconcileMock.isJobAlive).toHaveBeenCalledWith(existing.id)
    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(existing)
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[terminal Canvas row retains malformed paid handoff] -> [keeps dedupe and blocks replacement]', async () => {
    const existing = activeCanvasTask({
      status: TASK_STATUS.FAILED,
      externalId: 'ATLASCLOUD:AUDIO:CLAIM:123:owner',
    })
    prismaMock.task.findFirst.mockResolvedValueOnce(existing)

    await expect(createTask(createInput())).resolves.toEqual({ task: existing, deduped: true })

    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[queue probe saw no handoff, Canvas Atlas claim wins orphan CAS] -> [keeps authoritative task and never creates/refunds]', async () => {
    const stale = activeCanvasTask({ externalId: null })
    const claimed = activeCanvasTask({ externalId: 'ATLASCLOUD:AUDIO:CLAIM:123:owner' })
    prismaMock.task.findFirst
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(claimed)
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(createTask(createInput())).resolves.toEqual({ task: claimed, deduped: true })

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [{ externalId: null }, { externalId: '' }] }],
      }),
    }))
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it.each([
    'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1',
    'ATLASCLOUD:AUDIO:CLAIM:123:owner',
    'malformed-nonempty-handoff',
  ])('[stale Canvas processing handoff %s] -> [zero timeout CAS and zero refund]', async (externalId) => {
    prismaMock.task.findMany.mockResolvedValueOnce([activeCanvasTask({ externalId })])

    await expect(sweepStaleTasks({ processingThresholdMs: 60_000 })).resolves.toEqual([])

    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[Canvas task already has Atlas handoff] -> [cancel is rejected without refund]', async () => {
    prismaMock.task.findUnique.mockResolvedValue(activeCanvasTask())

    const result = await cancelTask('task-canvas-1')

    expect(result.cancelled).toBe(false)
    expect(result.providerHandoffProtected).toBe(true)
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[cancel snapshot has no handoff, Canvas claim wins terminal CAS] -> [conditional CAS loses and protects handoff]', async () => {
    const unclaimed = activeCanvasTask({ externalId: null })
    const claimed = activeCanvasTask({ externalId: 'ATLASCLOUD:AUDIO:CLAIM:123:owner' })
    prismaMock.task.findUnique
      .mockResolvedValueOnce(unclaimed)
      .mockResolvedValueOnce(claimed)
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await cancelTask('task-canvas-1')

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ externalId: null }, { externalId: '' }],
      }),
    }))
    expect(result).toMatchObject({ cancelled: false, providerHandoffProtected: true })
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })
})
