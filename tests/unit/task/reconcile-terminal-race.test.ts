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
const settleMock = vi.hoisted(() => vi.fn())
const queuesMock = vi.hoisted(() => ({
  imageQueue: { getJob: vi.fn() },
  videoQueue: { getJob: vi.fn() },
  voiceQueue: { getJob: vi.fn() },
  textQueue: { getJob: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/service', () => ({
  rollbackTaskBillingForTask: rollbackMock,
}))
vi.mock('@/lib/task/publisher', () => ({ publishTaskEvent: publishMock }))
vi.mock('@/lib/billing', () => ({ settleTaskBilling: settleMock }))
vi.mock('@/lib/task/queues', () => queuesMock)
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

import {
  isJobAlive,
  reconcileActiveTasks,
  reconcilePendingBillingSettlements,
} from '@/lib/task/reconcile'

function orphanTask() {
  return {
    id: 'task-orphan',
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: null,
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'VoiceLine',
    targetId: 'line-1',
    updatedAt: new Date(Date.now() - 120_000),
  }
}

describe('task reconcile terminal ownership', () => {
  let order: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    order = []
    prismaMock.task.findMany.mockResolvedValue([orphanTask()])
    prismaMock.task.updateMany.mockImplementation(async () => {
      order.push('claim')
      return { count: 1 }
    })
    for (const queue of Object.values(queuesMock)) {
      queue.getJob.mockResolvedValue(null)
    }
    rollbackMock.mockImplementation(async () => {
      order.push('rollback')
      return { attempted: true, rolledBack: true, billingInfo: null }
    })
    publishMock.mockResolvedValue({})
    settleMock.mockResolvedValue(null)
  })

  it('claims orphan failure before rolling billing back', async () => {
    const reconciled = await reconcileActiveTasks()

    expect(reconciled).toEqual(['task-orphan'])
    expect(order).toEqual(['claim', 'rollback'])
    expect(rollbackMock).toHaveBeenCalledWith({ taskId: 'task-orphan' })
    expect(prismaMock.task.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: 'task-orphan',
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
      data: {
        status: TASK_STATUS.FAILED,
        errorCode: 'RECONCILE_ORPHAN',
        dedupeKey: null,
      },
    })
  })

  it('loses the terminal CAS to a worker -> does not touch billing or publish failure', async () => {
    prismaMock.task.updateMany.mockImplementationOnce(async () => {
      order.push('claim')
      return { count: 0 }
    })

    const reconciled = await reconcileActiveTasks()

    expect(reconciled).toEqual([])
    expect(order).toEqual(['claim'])
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('keeps orphan lifecycle separate from a failed billing rollback', async () => {
    rollbackMock.mockImplementationOnce(async () => {
      order.push('rollback')
      return { attempted: true, rolledBack: false, billingInfo: null }
    })

    await reconcileActiveTasks()

    expect(prismaMock.task.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      errorCode: 'RECONCILE_ORPHAN',
    })
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ compensationFailed: true }),
    }))
  })

  it('treats a Redis probe error as unknown and never fails or refunds the task', async () => {
    queuesMock.imageQueue.getJob.mockRejectedValue(new Error('redis unavailable'))

    await expect(reconcileActiveTasks()).resolves.toEqual([])
    await expect(isJobAlive('task-orphan')).rejects.toThrow('Unable to determine BullMQ job state')

    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('[one queue reports terminal but another probe fails] -> [state stays unknown and terminal job is not retried]', async () => {
    queuesMock.imageQueue.getJob.mockRejectedValue(new Error('image queue unavailable'))
    queuesMock.voiceQueue.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('failed'),
    })

    await expect(isJobAlive('task-orphan')).rejects.toThrow('Unable to determine BullMQ job state')

    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('leases a pending completed settlement so concurrent watchdogs settle it once', async () => {
    const billedAt = null
    const pendingBilling = {
      billable: true as const,
      source: 'task' as const,
      taskType: TASK_TYPE.VOICE_LINE,
      apiType: 'voice' as const,
      model: 'voice-model',
      quantity: 5,
      unit: 'second' as const,
      maxFrozenCost: 1,
      action: 'voice.generate',
      freezeId: 'freeze-1',
      modeSnapshot: 'ENFORCE' as const,
      status: 'frozen' as const,
      settlement: {
        state: 'pending' as const,
        attempts: 1,
        textUsage: [],
        lastAttemptAt: new Date(0).toISOString(),
      },
    }
    prismaMock.task.findMany.mockResolvedValue([{
      id: 'task-billing',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: null,
      result: { url: 'https://example.test/result.mp4' },
      billingInfo: pendingBilling,
      billedAt,
    }])
    let leaseClaims = 0
    prismaMock.task.updateMany.mockImplementation(async (args: { data?: Record<string, unknown> }) => {
      if (args.data?.billedAt instanceof Date && !('billingInfo' in args.data)) {
        leaseClaims += 1
        return { count: leaseClaims === 1 ? 1 : 0 }
      }
      return { count: 1 }
    })
    settleMock.mockResolvedValue({ ...pendingBilling, status: 'settled', chargedCost: 0.4 })

    const [first, second] = await Promise.all([
      reconcilePendingBillingSettlements(),
      reconcilePendingBillingSettlements(),
    ])

    expect([...first, ...second]).toEqual(['task-billing'])
    expect(settleMock).toHaveBeenCalledTimes(1)
    expect(settleMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-billing', billingInfo: pendingBilling }),
      expect.objectContaining({ preserveFreezeOnFailure: true }),
    )
    expect(rollbackMock).not.toHaveBeenCalled()
  })

  it('releases a failed settlement lease while preserving the frozen reservation', async () => {
    const pendingBilling = {
      billable: true as const,
      source: 'task' as const,
      taskType: TASK_TYPE.VOICE_LINE,
      apiType: 'voice' as const,
      model: 'voice-model',
      quantity: 5,
      unit: 'second' as const,
      maxFrozenCost: 1,
      action: 'voice.generate',
      freezeId: 'freeze-1',
      modeSnapshot: 'ENFORCE' as const,
      status: 'frozen' as const,
      settlement: {
        state: 'pending' as const,
        attempts: 1,
        textUsage: [],
        lastAttemptAt: new Date(0).toISOString(),
      },
    }
    prismaMock.task.findMany.mockResolvedValue([{
      id: 'task-billing',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: null,
      result: {},
      billingInfo: pendingBilling,
      billedAt: null,
    }])
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    settleMock.mockRejectedValueOnce(new Error('billing temporarily unavailable'))

    await expect(reconcilePendingBillingSettlements()).resolves.toEqual([])

    expect(rollbackMock).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        billedAt: null,
        billingInfo: expect.objectContaining({
          status: 'frozen',
          settlement: expect.objectContaining({
            state: 'pending',
            attempts: 2,
            lastError: 'billing temporarily unavailable',
          }),
        }),
      }),
    }))
  })
})
