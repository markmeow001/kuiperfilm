import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type CreateTaskInput } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => ({
  rollbackTaskBilling: vi.fn(),
}))
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
}))
vi.mock('@/i18n/routing', () => ({
  locales: ['zh', 'en'],
}))

import { createTask } from '@/lib/task/service'

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-winner',
    userId: 'user-1',
    projectId: 'playground',
    episodeId: null,
    type: TASK_TYPE.CANVAS_TEXT,
    targetType: 'canvas-text',
    targetId: 'target-1',
    status: TASK_STATUS.QUEUED,
    progress: 0,
    attempt: 0,
    maxAttempts: 1,
    priority: 0,
    dedupeKey: 'canvas-text-r2v:key',
    externalId: null,
    payload: { meta: { locale: 'zh' } },
    result: null,
    errorCode: null,
    errorMessage: null,
    billingInfo: null,
    billedAt: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    enqueuedAt: null,
    enqueueAttempts: 0,
    lastEnqueueError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function input(): CreateTaskInput {
  return {
    userId: 'user-1',
    projectId: 'playground',
    type: TASK_TYPE.CANVAS_TEXT,
    targetType: 'canvas-text',
    targetId: 'target-2',
    payload: { meta: { locale: 'zh' } },
    dedupeKey: 'canvas-text-r2v:key',
    dedupeMode: 'idempotent',
    maxAttempts: 1,
  }
}

describe('createTask idempotent dedupe mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replays an existing terminal task instead of releasing its key', async () => {
    const completed = task({
      status: TASK_STATUS.COMPLETED,
      finishedAt: new Date(),
      result: { text: '完成描述' },
    })
    prismaMock.task.findFirst.mockResolvedValue(completed)

    const result = await createTask(input())

    expect(result).toEqual({ task: completed, deduped: true })
    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('uses the unique-key collision winner during overlapping submissions', async () => {
    const winner = task()
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    prismaMock.task.create.mockRejectedValueOnce({ code: 'P2002' })

    const result = await createTask(input())

    expect(result).toEqual({ task: winner, deduped: true })
    expect(prismaMock.task.create).toHaveBeenCalledOnce()
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })
})
