import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    updateMany: vi.fn(),
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

import { tryMarkTaskProcessing } from '@/lib/task/service'

describe('task processing externalId preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
  })

  it('queue retry with an existing externalId -> processing transition does not clear the provider id', async () => {
    const updated = await tryMarkTaskProcessing('task-1')

    expect(updated).toBe(true)
    const update = prismaMock.task.updateMany.mock.calls.at(-1)?.[0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(update.where).toEqual({
      id: 'task-1',
      status: { in: ['queued', 'processing'] },
    })
    expect(update.data).toMatchObject({
      status: 'processing',
      attempt: { increment: 1 },
    })
    expect(update.data).not.toHaveProperty('externalId')
  })

  it('caller explicitly supplies an externalId -> processing transition stores its trimmed value', async () => {
    await tryMarkTaskProcessing('task-1', '  ATLASCLOUD:VIDEO:req-1  ')

    const update = prismaMock.task.updateMany.mock.calls.at(-1)?.[0] as {
      data: Record<string, unknown>
    }
    expect(update.data.externalId).toBe('ATLASCLOUD:VIDEO:req-1')
  })
})
