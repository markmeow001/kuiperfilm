import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const generatorMock = vi.hoisted(() => ({
  generateImage: vi.fn(),
  generateVideo: vi.fn(),
}))

const utilsMock = vi.hoisted(() => ({
  uploadImageSourceToCos: vi.fn(async () => 'cos/image-key'),
  uploadVideoSourceToCos: vi.fn(async () => 'cos/video-key'),
  waitExternalResult: vi.fn(),
  toSignedUrlIfCos: vi.fn((key: string) => `signed:${key}`),
}))

vi.mock('@/lib/generator-api', () => generatorMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}))
// 尾帧抽取走真实 ffmpeg + @/lib/cos(其 import 链会拉进未 mock 的模块),
// 单测里直接 mock 掉;续镜链行为由 canvas-refs 单测覆盖。
vi.mock('@/lib/video-tail-frame', () => ({
  extractVideoTailFrameToCos: vi.fn(async () => 'cos/tail-frame-key'),
}))

import { handlePlaygroundImageTask } from '@/lib/workers/handlers/playground-image'
import { handlePlaygroundVideoTask } from '@/lib/workers/handlers/playground-video'

function makeJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: 'playground_image',
      locale: 'zh',
      projectId: 'playground',
      targetType: 'playground',
      targetId: 'task-1',
      userId: 'user-1',
      payload,
    },
  } as unknown as Job<TaskJobData>
}

describe('handlePlaygroundImageTask (Phase 9.1 Task-spine handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    utilsMock.uploadImageSourceToCos.mockResolvedValue('cos/image-key')
    utilsMock.toSignedUrlIfCos.mockImplementation((key: string) => `signed:${key}`)
  })

  it('returns resultUrls for a sync provider that yields a url immediately', async () => {
    generatorMock.generateImage.mockResolvedValue({ success: true, url: 'https://prov/img.png' })

    const result = await handlePlaygroundImageTask(
      makeJob({ prompt: 'a cat', modelKey: 'atlascloud::nano-banana' }),
    )

    expect(result).toEqual({ resultUrls: ['cos/image-key'] })
    expect(generatorMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      'atlascloud::nano-banana',
      'a cat',
      expect.any(Object),
    )
    // Source url (not externalId path) — no polling.
    expect(utilsMock.waitExternalResult).not.toHaveBeenCalled()
    expect(utilsMock.uploadImageSourceToCos).toHaveBeenCalledWith(
      'https://prov/img.png',
      'playground-runs/task-1',
      'task-1',
    )
  })

  it('polls externalId for an async provider then returns resultUrls', async () => {
    generatorMock.generateImage.mockResolvedValue({ success: true, externalId: 'ext-9' })
    utilsMock.waitExternalResult.mockResolvedValue({ url: 'https://prov/polled.png' })

    const result = await handlePlaygroundImageTask(
      makeJob({ prompt: 'a dog', modelKey: 'atlascloud::nano-banana', referenceImages: ['cos/ref-1'] }),
    )

    expect(result).toEqual({ resultUrls: ['cos/image-key'] })
    expect(utilsMock.waitExternalResult).toHaveBeenCalledOnce()
    expect(utilsMock.uploadImageSourceToCos).toHaveBeenCalledWith(
      'https://prov/polled.png',
      'playground-runs/task-1',
      'task-1',
    )
  })

  it('throws when the generator reports failure (loud, no silent swallow)', async () => {
    generatorMock.generateImage.mockResolvedValue({ success: false, error: 'quota exceeded' })

    await expect(
      handlePlaygroundImageTask(makeJob({ prompt: 'x', modelKey: 'atlascloud::nano-banana' })),
    ).rejects.toThrow(/PLAYGROUND_IMAGE_SUBMIT_FAILED: quota exceeded/)
  })

  it('signs and forwards maskImage (局部重绘) alongside the reference plate', async () => {
    generatorMock.generateImage.mockResolvedValue({ success: true, url: 'https://prov/inpainted.png' })

    await handlePlaygroundImageTask(
      makeJob({
        prompt: '换背景',
        modelKey: 'atlascloud::gpt-image-1',
        referenceImages: ['cos/plate-1'],
        maskImage: 'cos/mask-1',
      }),
    )

    expect(generatorMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      'atlascloud::gpt-image-1',
      '换背景',
      expect.objectContaining({
        referenceImages: ['signed:cos/plate-1'],
        maskImage: 'signed:cos/mask-1',
      }),
    )
  })

  it('omits maskImage from generator options when absent', async () => {
    generatorMock.generateImage.mockResolvedValue({ success: true, url: 'https://prov/img.png' })

    await handlePlaygroundImageTask(
      makeJob({ prompt: 'a cat', modelKey: 'atlascloud::nano-banana' }),
    )

    const options = generatorMock.generateImage.mock.calls[0][3] as Record<string, unknown>
    expect(options).not.toHaveProperty('maskImage')
  })

  it('throws when prompt or modelKey missing', async () => {
    await expect(handlePlaygroundImageTask(makeJob({ modelKey: 'm' }))).rejects.toThrow(
      /PLAYGROUND_IMAGE_PROMPT_REQUIRED/,
    )
    await expect(handlePlaygroundImageTask(makeJob({ prompt: 'p' }))).rejects.toThrow(
      /PLAYGROUND_IMAGE_MODEL_REQUIRED/,
    )
  })
})

describe('handlePlaygroundVideoTask (Phase 9.1 Task-spine handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    utilsMock.uploadVideoSourceToCos.mockResolvedValue('cos/video-key')
    utilsMock.toSignedUrlIfCos.mockImplementation((key: string) => `signed:${key}`)
  })

  it('submits, polls externalId, uploads and returns resultUrls', async () => {
    generatorMock.generateVideo.mockResolvedValue({ success: true, externalId: 'vid-1' })
    utilsMock.waitExternalResult.mockResolvedValue({ url: 'https://prov/clip.mp4' })

    const result = await handlePlaygroundVideoTask(
      makeJob({ prompt: 'a chase', modelKey: 'fal::seedance', duration: 5, resolution: '720p' }),
    )

    // tailFrameKey: 视频结果尾帧(2026-07-08 续镜链)— worker 抽帧成功时
    // 一并写进 result,供画布 video→下游 连线做首尾帧接力。
    expect(result).toEqual({ resultUrls: ['cos/video-key'], tailFrameKey: 'cos/tail-frame-key' })
    expect(generatorMock.generateVideo).toHaveBeenCalledOnce()
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://prov/clip.mp4',
      'playground-runs/task-1',
      'task-1',
      undefined,
    )
  })

  it('throws when the generator returns no externalId', async () => {
    generatorMock.generateVideo.mockResolvedValue({ success: true })

    await expect(
      handlePlaygroundVideoTask(makeJob({ prompt: 'x', modelKey: 'fal::seedance' })),
    ).rejects.toThrow(/PLAYGROUND_VIDEO_SUBMIT_FAILED/)
  })
})
