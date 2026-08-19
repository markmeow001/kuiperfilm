import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async <T>(operation: () => Promise<T>) => await operation()),
}))

import { releaseRejectedProviderSubmitClaimOrThrow } from '@/lib/task/provider-submit-claim'

describe('provider submit claim release', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
  })

  it('[provider explicit negative ack] -> [clears only exact claim on active task]', async () => {
    await releaseRejectedProviderSubmitClaimOrThrow('task-1', ' CLAIM-1 ')

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: { in: ['queued', 'processing'] },
        externalId: 'CLAIM-1',
      },
      data: { externalId: null },
    })
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
  })

  it('[claim release response lost but DB is empty] -> [reconciles success]', async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.task.findUnique.mockResolvedValue({ externalId: null })

    await expect(releaseRejectedProviderSubmitClaimOrThrow('task-1', 'CLAIM-1'))
      .resolves.toBeUndefined()
  })

  it('[claim was replaced by an actual provider id] -> [fails closed and never clears it]', async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.task.findUnique.mockResolvedValue({
      externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1',
    })

    await expect(releaseRejectedProviderSubmitClaimOrThrow('task-1', 'CLAIM-1'))
      .rejects.toThrow('TASK_EXTERNAL_ID_CLAIM_RELEASE_FAILED')
  })
})
