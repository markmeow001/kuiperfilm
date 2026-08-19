import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
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

import { tryUpdateTaskProgress, updateTaskPayload } from '@/lib/task/service'

describe('task progress payload durability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findUnique.mockResolvedValue({
      status: 'processing',
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
    prismaMock.task.update.mockResolvedValue({ id: 'task-1' })
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
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'task-1',
        payload: { equals: expect.objectContaining({
          prompt: 'original reconstruction prompt',
        }) },
      }),
    }))
  })

  it('[publication marker wins between progress read and write] -> [retries merge without erasing marker]', async () => {
    const initialPayload = {
      prompt: 'original reconstruction prompt',
      meta: { locale: 'zh' },
    }
    const marker = {
      kind: 'voice_line_publication_v1',
      outputUrl: 'voice/exact.wav',
    }
    prismaMock.task.findUnique
      .mockResolvedValueOnce({ status: 'processing', payload: initialPayload })
      .mockResolvedValueOnce({
        status: 'processing',
        payload: { ...initialPayload, voiceLinePublication: marker },
      })
    prismaMock.task.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    await expect(tryUpdateTaskProgress('task-1', 55, {
      stage: 'generate_voice_persist',
    })).resolves.toBe(true)

    expect(prismaMock.task.updateMany).toHaveBeenCalledTimes(2)
    const lastUpdate = prismaMock.task.updateMany.mock.calls.at(-1)?.[0]
    expect(lastUpdate.data.payload).toEqual({
      ...initialPayload,
      voiceLinePublication: marker,
      stage: 'generate_voice_persist',
      meta: { locale: 'zh' },
    })
    expect(lastUpdate.where.payload).toEqual({ equals: {
      ...initialPayload,
      voiceLinePublication: marker,
    } })
  })

  it('durable reconciliation marker update can preserve the original top-level job contract', async () => {
    prismaMock.task.findUnique.mockResolvedValueOnce({
      status: 'processing',
      payload: {
        prompt: 'original reconstruction prompt',
        modelKey: 'atlascloud::seedance-2.0-r2v',
        meta: { locale: 'zh' },
      },
    })
    const marker = {
      kind: 'panel_video_persist',
      taskId: 'task-1',
      panelId: 'panel-1',
      episodeId: 'episode-1',
      cosKey: 'video/panel-1.mp4',
    }

    await updateTaskPayload(
      'task-1',
      { panelVideoPersistMarker: marker },
      { preserveExistingTopLevel: true },
    )

    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        payload: expect.objectContaining({
          prompt: 'original reconstruction prompt',
          modelKey: 'atlascloud::seedance-2.0-r2v',
          panelVideoPersistMarker: marker,
        }),
      },
    })
  })
})
