import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { compareAndSetNovelPromotionPanelVideoFromBatchQuote } from '@/lib/novel-promotion/project-scope'

const source = {
  updatedAt: '2026-08-10T10:00:00.000Z',
  imageUrl: 'images/panel-1.png',
  imageMediaId: null,
  description: 'hero walks through rain',
  videoPrompt: 'slow push in',
  firstLastFramePrompt: null,
  srtSegment: null,
  videoUrl: null,
  videoMediaId: null,
}

describe('batch video panel compare-and-set', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionPanel.updateMany.mockResolvedValue({ count: 1 })
  })

  it('pins project, episode, exact quoted source, and empty outputs in one update', async () => {
    await expect(compareAndSetNovelPromotionPanelVideoFromBatchQuote(
      'project-1',
      'panel-1',
      'episode-1',
      source,
      { videoUrl: 'video/panel-1.mp4', videoGenerationMode: 'normal' },
    )).resolves.toBe(true)

    expect(prismaMock.novelPromotionPanel.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'panel-1',
        storyboard: {
          episodeId: 'episode-1',
          episode: { novelPromotionProject: { projectId: 'project-1' } },
        },
        updatedAt: new Date(source.updatedAt),
        imageUrl: source.imageUrl,
        imageMediaId: source.imageMediaId,
        description: source.description,
        videoPrompt: source.videoPrompt,
        firstLastFramePrompt: source.firstLastFramePrompt,
        srtSegment: source.srtSegment,
        videoUrl: null,
        videoMediaId: null,
      },
      data: { videoUrl: 'video/panel-1.mp4', videoGenerationMode: 'normal' },
    })
  })

  it('returns false when any source/output field changed before persistence', async () => {
    prismaMock.novelPromotionPanel.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(compareAndSetNovelPromotionPanelVideoFromBatchQuote(
      'project-1',
      'panel-1',
      'episode-1',
      source,
      { videoUrl: 'video/panel-1.mp4', videoGenerationMode: 'normal' },
    )).resolves.toBe(false)
  })
})
