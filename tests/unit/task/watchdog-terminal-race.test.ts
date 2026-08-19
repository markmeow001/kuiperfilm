import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

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

const billingMock = vi.hoisted(() => ({
  rollbackTaskBilling: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async <T>(operation: () => Promise<T>) => await operation()),
}))
vi.mock('@/i18n/routing', () => ({ locales: ['zh', 'en'] }))

import { createTask, sweepStaleTasks } from '@/lib/task/service'

const frozenBilling: Extract<TaskBillingInfo, { billable: true }> = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.VOICE_LINE,
  apiType: 'voice',
  model: 'voice-model',
  quantity: 5,
  unit: 'second',
  maxFrozenCost: 1,
  action: 'voice.generate',
  freezeId: 'freeze-1',
  modeSnapshot: 'ENFORCE',
  status: 'frozen',
}

function staleTask() {
  return {
    id: 'task-stale',
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: null,
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'VoiceLine',
    targetId: 'line-1',
    billingInfo: { ...frozenBilling },
  }
}

describe('watchdog and preflight terminal ownership', () => {
  let order: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    order = []
    prismaMock.task.findUnique.mockResolvedValue({ billingInfo: { ...frozenBilling } })
    prismaMock.task.update.mockResolvedValue({})
    prismaMock.task.updateMany.mockImplementation(async () => {
      order.push('claim')
      return { count: 1 }
    })
    billingMock.rollbackTaskBilling.mockImplementation(async () => {
      order.push('rollback')
      return { ...frozenBilling, status: 'rolled_back' as const }
    })
  })

  it('watchdog re-checks staleness, claims failure, then rolls billing back', async () => {
    prismaMock.task.findMany.mockResolvedValue([staleTask()])

    const result = await sweepStaleTasks({ processingThresholdMs: 60_000 })

    expect(order).toEqual(['claim', 'rollback'])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      errorCode: 'WATCHDOG_TIMEOUT',
      compensationFailed: false,
    })
    const claim = prismaMock.task.updateMany.mock.calls[0]?.[0]
    expect(claim.where).toMatchObject({
      id: 'task-stale',
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      AND: [
        {
          AND: [
            expect.objectContaining({ status: TASK_STATUS.PROCESSING }),
            {
              OR: [{ externalId: null }, { externalId: '' }],
            },
          ],
        },
      ],
    })
    expect(claim.where.AND[0].AND[0].OR).toHaveLength(3)
  })

  it('watchdog loses the terminal CAS -> never rolls billing back', async () => {
    prismaMock.task.findMany.mockResolvedValue([staleTask()])
    prismaMock.task.updateMany.mockImplementationOnce(async () => {
      order.push('claim')
      return { count: 0 }
    })

    const result = await sweepStaleTasks({ processingThresholdMs: 60_000 })

    expect(result).toEqual([])
    expect(order).toEqual(['claim'])
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
  })

  it('keeps WATCHDOG_TIMEOUT when billing compensation fails', async () => {
    prismaMock.task.findMany.mockResolvedValue([staleTask()])
    billingMock.rollbackTaskBilling.mockImplementationOnce(async () => {
      order.push('rollback')
      return { ...frozenBilling, status: 'failed' as const }
    })

    const result = await sweepStaleTasks({ processingThresholdMs: 60_000 })

    expect(result[0]).toMatchObject({
      errorCode: 'WATCHDOG_TIMEOUT',
      errorMessage: 'Task heartbeat timeout',
      compensationFailed: true,
    })
    expect(prismaMock.task.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'WATCHDOG_TIMEOUT',
    })
  })

  it('missing-locale preflight claims failure before refunding and replacing', async () => {
    const existing = {
      ...staleTask(),
      status: TASK_STATUS.QUEUED,
      payload: {},
      dedupeKey: 'voice:key',
    }
    const created = { ...existing, id: 'task-new', payload: { meta: { locale: 'zh' } } }
    prismaMock.task.findFirst.mockResolvedValue(existing)
    prismaMock.task.create.mockImplementation(async () => {
      order.push('create')
      return created
    })

    const result = await createTask({
      userId: 'user-1',
      projectId: 'project-1',
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'VoiceLine',
      targetId: 'line-2',
      payload: { meta: { locale: 'zh' } },
      dedupeKey: 'voice:key',
    })

    expect(result).toEqual({ task: created, deduped: false })
    expect(order).toEqual(['claim', 'rollback', 'create'])
    expect(prismaMock.task.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'TASK_LOCALE_REQUIRED',
      dedupeKey: null,
    })
  })
})
