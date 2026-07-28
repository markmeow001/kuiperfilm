import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const generatorMock = vi.hoisted(() => ({ generateImage: vi.fn() }))
const utilsMock = vi.hoisted(() => ({
  uploadImageSourceToCos: vi.fn(async () => 'images/visual-development/result.png'),
  waitExternalResult: vi.fn(),
  toSignedUrlIfCos: vi.fn((key: string) => `signed:${key}`),
}))

vi.mock('@/lib/generator-api', () => generatorMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/logging/core', () => ({ logInfo: vi.fn(), logError: vi.fn() }))

import { handlePlaygroundImageTask } from '@/lib/workers/handlers/playground-image'

function makeJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'visual-task-1',
      type: TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'visual-development-candidate',
      targetId: 'candidate-1',
      userId: 'user-1',
      payload: {
        prompt: 'fictional adult casting portrait',
        modelKey: 'tencent-vod::SI-5.0-lite',
        negativePrompt: 'anime, CGI',
        seed: 184729,
        aspectRatio: '4:5',
        resolution: '2K',
      },
    },
  } as unknown as Job<TaskJobData>
}

describe('visual development image task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generatorMock.generateImage.mockResolvedValue({ success: true, url: 'https://provider.test/casting.png' })
  })

  it('forwards the bound model and seed and stores output under visual-development', async () => {
    const result = await handlePlaygroundImageTask(makeJob())

    expect(generatorMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      'tencent-vod::SI-5.0-lite',
      'fictional adult casting portrait',
      expect.objectContaining({
        negativePrompt: 'anime, CGI',
        seed: 184729,
        aspectRatio: '4:5',
        resolution: '2K',
      }),
    )
    expect(utilsMock.uploadImageSourceToCos).toHaveBeenCalledWith(
      'https://provider.test/casting.png',
      'visual-development/visual-task-1',
      'visual-task-1',
    )
    expect(result).toEqual({ resultUrls: ['images/visual-development/result.png'] })
  })

  it('signs and forwards the Canon image as the Face Lock identity reference', async () => {
    const job = makeJob()
    job.data.payload = {
      ...job.data.payload,
      prompt: 'use reference image 1 exclusively as identity; change only camera view',
      referenceImages: ['images/visual-development/canon.png'],
    }

    await handlePlaygroundImageTask(job)

    expect(utilsMock.toSignedUrlIfCos).toHaveBeenCalledWith(
      'images/visual-development/canon.png',
      7200,
    )
    expect(generatorMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      'tencent-vod::SI-5.0-lite',
      'use reference image 1 exclusively as identity; change only camera view',
      expect.objectContaining({
        referenceImages: ['signed:images/visual-development/canon.png'],
      }),
    )
  })
})
