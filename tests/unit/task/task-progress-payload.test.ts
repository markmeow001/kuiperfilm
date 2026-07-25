import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
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

import { tryUpdateTaskProgress } from '@/lib/task/service'

describe('task progress payload durability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findUnique.mockResolvedValue({
      payload: {
        prompt: 'original reconstruction prompt',
        modelKey: 'atlascloud::seedance-2.0-r2v',
        sourceAudioMode: 'reference-only',
        referenceVideos: ['source-video-key'],
        meta: {
          locale: 'zh',
          originPrompt: 'original reconstruction prompt',
        },
      },
    })
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
  })

  it('runtime progress keeps the original job contract for watchdog requeue', async () => {
    const updated = await tryUpdateTaskProgress('task-1', 42, {
      stage: 'polling_provider',
      message: '生成中',
      meta: { providerRequestId: 'provider-1' },
    })

    expect(updated).toBe(true)
    const update = prismaMock.task.updateMany.mock.calls.at(-1)?.[0] as {
      data: { payload: Record<string, unknown> }
    }
    expect(update.data.payload).toEqual({
      prompt: 'original reconstruction prompt',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      sourceAudioMode: 'reference-only',
      referenceVideos: ['source-video-key'],
      stage: 'polling_provider',
      message: '生成中',
      meta: {
        locale: 'zh',
        originPrompt: 'original reconstruction prompt',
        providerRequestId: 'provider-1',
      },
    })
  })
})
