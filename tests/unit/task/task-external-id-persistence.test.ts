import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
}))

const prismaRetryMock = vi.hoisted(() => ({
  withPrismaRetry: vi.fn(async <T>(operation: () => Promise<T>) => await operation()),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => ({ rollbackTaskBilling: vi.fn() }))
vi.mock('@/lib/prisma-retry', () => prismaRetryMock)
vi.mock('@/i18n/routing', () => ({ locales: ['zh', 'en'] }))

import { persistTaskExternalIdOrThrow } from '@/lib/task/service'

describe('paid task externalId persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.task.findUnique.mockResolvedValue(null)
  })

  it('active task has no provider id -> atomically stores the exact trimmed externalId', async () => {
    await persistTaskExternalIdOrThrow(
      'task-1',
      '  ATLASCLOUD:VIDEO:paid-request  ',
    )

    expect(prismaMock.task.updateMany.mock.calls.at(-1)?.[0]).toEqual({
      where: {
        id: 'task-1',
        status: { in: ['queued', 'processing'] },
        OR: [{ externalId: null }, { externalId: '' }],
      },
      data: { externalId: 'ATLASCLOUD:VIDEO:paid-request' },
    })
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
  })

  it('conditional write lost a race but same id is durable -> treats hand-off as persisted', async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.task.findUnique.mockResolvedValue({
      externalId: 'ATLASCLOUD:VIDEO:paid-request',
    })

    await expect(persistTaskExternalIdOrThrow(
      'task-1',
      'ATLASCLOUD:VIDEO:paid-request',
    )).resolves.toBeUndefined()

    expect(prismaMock.task.findUnique).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      select: { externalId: true },
    })
  })

  it('provider id is not durable after conditional write -> fails before polling', async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.task.findUnique.mockResolvedValue({ externalId: null })

    await expect(persistTaskExternalIdOrThrow(
      'task-1',
      'ATLASCLOUD:VIDEO:paid-request',
    )).rejects.toThrow('TASK_EXTERNAL_ID_PERSIST_FAILED')
  })
})
