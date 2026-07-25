import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const generatorMock = vi.hoisted(() => ({
  generateImage: vi.fn(),
  generateVideo: vi.fn(),
}))

const utilsMock = vi.hoisted(() => ({
  getTaskExistingExternalId: vi.fn(async () => null as string | null),
  uploadImageSourceToCos: vi.fn(async () => 'cos/image-key'),
  uploadVideoSourceToCos: vi.fn(async () => 'cos/video-key'),
  waitExternalResult: vi.fn(),
  toSignedUrlIfCos: vi.fn((key: string) => `signed:${key}`),
}))

const sourceAudioMock = vi.hoisted(() => ({
  extractReferenceAudioToCos: vi.fn(async () => 'cos/source-audio.mp3'),
  muxGeneratedVideoWithSourceAudio: vi.fn(async () => Buffer.from('muxed-video')),
  stripGeneratedVideoAudio: vi.fn(async () => Buffer.from('silent-video')),
}))

const seedanceReferenceMock = vi.hoisted(() => ({
  isSeedanceReferenceNormalizationModel: vi.fn(
    (modelKey: string) => modelKey === 'atlascloud::seedance-2.0-r2v'
      || modelKey === 'atlascloud::seedance-2.0-fast-r2v',
  ),
  normalizeSeedanceReferenceVideoToCos: vi.fn(async () => ({
    cosKey: 'video/playground-runs/seedance-reference-task-1.mp4',
    probe: {
      formatNames: ['mov', 'mp4'],
      sizeBytes: 2_000_000,
      durationSec: 12,
      videoCodec: 'h264',
      width: 720,
      height: 1280,
      fps: 24,
      hasAudio: true,
    },
  })),
}))

const referenceGuardMock = vi.hoisted(() => ({
  filterAuthorizedStorageReferences: vi.fn(async (refs: string[]) => ({
    safe: refs,
    rejected: [] as string[],
  })),
}))

vi.mock('@/lib/generator-api', () => generatorMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn() }))
vi.mock('@/lib/playground/source-audio', () => sourceAudioMock)
vi.mock('@/lib/playground/seedance-reference-video', () => seedanceReferenceMock)
vi.mock('@/lib/playground/reference-guard', () => referenceGuardMock)
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
    utilsMock.getTaskExistingExternalId.mockResolvedValue(null)
    utilsMock.uploadVideoSourceToCos.mockResolvedValue('cos/video-key')
    utilsMock.toSignedUrlIfCos.mockImplementation((key: string) => `signed:${key}`)
    referenceGuardMock.filterAuthorizedStorageReferences.mockImplementation(async (refs: string[]) => ({
      safe: refs,
      rejected: [],
    }))
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos.mockResolvedValue({
      cosKey: 'video/playground-runs/seedance-reference-task-1.mp4',
      probe: {
        formatNames: ['mov', 'mp4'],
        sizeBytes: 2_000_000,
        durationSec: 12,
        videoCodec: 'h264',
        width: 720,
        height: 1280,
        fps: 24,
        hasAudio: true,
      },
    })
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

  it('已有 externalId 的 queue retry -> 只恢復輪詢，不重複正規化或呼叫 generateVideo', async () => {
    utilsMock.getTaskExistingExternalId.mockResolvedValue('ATLASCLOUD:VIDEO:existing-request')
    utilsMock.waitExternalResult.mockResolvedValue({ url: 'https://prov/resumed.mp4' })

    const result = await handlePlaygroundVideoTask(makeJob({
      prompt: 'follow the depth motion',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/depth.webm'],
      normalizeSeedanceReferenceVideo: true,
    }))

    expect(result).toEqual({
      resultUrls: ['cos/video-key'],
      tailFrameKey: 'cos/tail-frame-key',
    })
    expect(utilsMock.waitExternalResult).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ taskId: 'task-1' }) }),
      'ATLASCLOUD:VIDEO:existing-request',
      'user-1',
      {
        timeoutMs: 15 * 60 * 1000,
        progressStart: 30,
        progressEnd: 90,
      },
    )
    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://prov/resumed.mp4',
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

  it('preserves source dialogue audio and uploads the muxed result without falling back', async () => {
    generatorMock.generateVideo.mockResolvedValue({ success: true, externalId: 'vid-audio' })
    utilsMock.waitExternalResult.mockResolvedValue({ url: 'https://prov/generated.mp4' })

    await handlePlaygroundVideoTask(makeJob({
      prompt: 'reconstruct the shot',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source.mp4'],
      preserveSourceAudio: true,
    }))

    expect(sourceAudioMock.extractReferenceAudioToCos).toHaveBeenCalledWith('signed:cos/source.mp4', 'task-1')
    expect(sourceAudioMock.muxGeneratedVideoWithSourceAudio).toHaveBeenCalledWith(expect.objectContaining({
      generatedVideoUrl: 'https://prov/generated.mp4',
      sourceVideoUrl: 'signed:cos/source.mp4',
    }))
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      expect.any(Buffer),
      'playground-runs/task-1',
      'task-1',
      undefined,
    )
  })

  it('sourceAudioMode=preserve -> 參考原音、關閉模型生音，最後封裝原始音軌', async () => {
    generatorMock.generateVideo.mockResolvedValue({ success: true, externalId: 'vid-preserve-mode' })
    utilsMock.waitExternalResult.mockResolvedValue({
      url: 'https://prov/generated-preserve.mp4',
      downloadHeaders: { Authorization: 'Bearer generated' },
    })

    await handlePlaygroundVideoTask(makeJob({
      prompt: 'keep the original dialogue',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source.mp4'],
      normalizeSeedanceReferenceVideo: true,
      sourceAudioMode: 'preserve',
    }))

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).toHaveBeenCalledWith({
      sourceVideoUrl: 'signed:cos/source.mp4',
      taskId: 'task-1',
      requireAudio: true,
      sourceAudioMode: 'preserve',
    })
    expect(sourceAudioMock.extractReferenceAudioToCos).toHaveBeenCalledWith(
      'signed:video/playground-runs/seedance-reference-task-1.mp4',
      'task-1',
    )
    const options = generatorMock.generateVideo.mock.calls.at(-1)?.[3] as Record<string, unknown>
    expect(options).toMatchObject({
      generateAudio: false,
      referenceVideos: ['signed:video/playground-runs/seedance-reference-task-1.mp4'],
      referenceAudios: ['signed:cos/source-audio.mp3'],
    })
    expect(sourceAudioMock.muxGeneratedVideoWithSourceAudio).toHaveBeenCalledWith({
      generatedVideoUrl: 'https://prov/generated-preserve.mp4',
      generatedDownloadHeaders: { Authorization: 'Bearer generated' },
      sourceVideoUrl: 'signed:video/playground-runs/seedance-reference-task-1.mp4',
    })
    expect(sourceAudioMock.stripGeneratedVideoAudio).not.toHaveBeenCalled()
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      Buffer.from('muxed-video'),
      'playground-runs/task-1',
      'task-1',
      undefined,
    )
  })

  it('sourceAudioMode=reference-only -> 參考原音、關閉模型生音，成片明確移除音軌', async () => {
    generatorMock.generateVideo.mockResolvedValue({
      success: true,
      externalId: 'vid-reference-only-mode',
    })
    utilsMock.waitExternalResult.mockResolvedValue({
      url: 'https://prov/generated-reference-only.mp4',
      downloadHeaders: { Authorization: 'Bearer generated' },
    })

    await handlePlaygroundVideoTask(makeJob({
      prompt: 'use the source dialogue only as performance guidance',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source.mp4'],
      normalizeSeedanceReferenceVideo: true,
      sourceAudioMode: 'reference-only',
    }))

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).toHaveBeenCalledWith({
      sourceVideoUrl: 'signed:cos/source.mp4',
      taskId: 'task-1',
      requireAudio: true,
      sourceAudioMode: 'reference-only',
    })
    expect(sourceAudioMock.extractReferenceAudioToCos).toHaveBeenCalledWith(
      'signed:video/playground-runs/seedance-reference-task-1.mp4',
      'task-1',
    )
    const options = generatorMock.generateVideo.mock.calls.at(-1)?.[3] as Record<string, unknown>
    expect(options).toMatchObject({
      generateAudio: false,
      referenceAudios: ['signed:cos/source-audio.mp3'],
    })
    expect(sourceAudioMock.muxGeneratedVideoWithSourceAudio).not.toHaveBeenCalled()
    expect(sourceAudioMock.stripGeneratedVideoAudio).toHaveBeenCalledWith({
      generatedVideoUrl: 'https://prov/generated-reference-only.mp4',
      generatedDownloadHeaders: { Authorization: 'Bearer generated' },
    })
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      Buffer.from('silent-video'),
      'playground-runs/task-1',
      'task-1',
      undefined,
    )
  })

  it('sourceAudioMode=generate -> 正規化先移除來源音軌，只讓模型生成新聲音', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos.mockResolvedValue({
      cosKey: 'video/playground-runs/seedance-reference-task-1.mp4',
      probe: {
        formatNames: ['mov', 'mp4'],
        sizeBytes: 2_000_000,
        durationSec: 12,
        videoCodec: 'h264',
        width: 720,
        height: 1280,
        fps: 24,
        hasAudio: false,
      },
    })
    generatorMock.generateVideo.mockResolvedValue({ success: true, externalId: 'vid-generate-mode' })
    utilsMock.waitExternalResult.mockResolvedValue({
      url: 'https://prov/generated-audio.mp4',
      downloadHeaders: { Authorization: 'Bearer generated' },
    })

    await handlePlaygroundVideoTask(makeJob({
      prompt: 'generate new ambience and dialogue',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source.mp4'],
      normalizeSeedanceReferenceVideo: true,
      sourceAudioMode: 'generate',
    }))

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).toHaveBeenCalledWith({
      sourceVideoUrl: 'signed:cos/source.mp4',
      taskId: 'task-1',
      requireAudio: false,
      sourceAudioMode: 'generate',
    })
    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    const options = generatorMock.generateVideo.mock.calls.at(-1)?.[3] as Record<string, unknown>
    expect(options.generateAudio).toBe(true)
    expect(options).not.toHaveProperty('referenceAudios')
    expect(sourceAudioMock.muxGeneratedVideoWithSourceAudio).not.toHaveBeenCalled()
    expect(sourceAudioMock.stripGeneratedVideoAudio).not.toHaveBeenCalled()
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://prov/generated-audio.mp4',
      'playground-runs/task-1',
      'task-1',
      { Authorization: 'Bearer generated' },
    )
  })

  it.each([
    {
      payload: { sourceAudioMode: 'unknown' },
      code: 'PLAYGROUND_SOURCE_AUDIO_MODE_INVALID',
    },
    {
      payload: { sourceAudioMode: 'preserve', preserveSourceAudio: false },
      code: 'PLAYGROUND_SOURCE_AUDIO_MODE_LEGACY_FLAGS_CONFLICT',
    },
    {
      payload: { sourceAudioMode: 'preserve', generateAudio: false },
      code: 'PLAYGROUND_SOURCE_AUDIO_MODE_LEGACY_FLAGS_CONFLICT',
    },
  ])('來源音訊契約錯誤 $code -> 付費生成前顯式失敗', async ({ payload, code }) => {
    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'rebuild',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source.mp4'],
      normalizeSeedanceReferenceVideo: true,
      ...payload,
    }))).rejects.toThrow(code)

    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
  })

  it('深度重建旗標開啟 -> 先正規化唯一參考影片，再把相同 MP4 用於生成與音軌保留', async () => {
    generatorMock.generateVideo.mockResolvedValue({ success: true, externalId: 'vid-normalized' })
    utilsMock.waitExternalResult.mockResolvedValue({ url: 'https://prov/generated.mp4' })

    await handlePlaygroundVideoTask(makeJob({
      prompt: 'follow the grayscale depth motion',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      preserveSourceAudio: true,
    }))

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).toHaveBeenCalledWith({
      sourceVideoUrl: 'signed:cos/depth.webm',
      taskId: 'task-1',
      requireAudio: true,
    })
    expect(sourceAudioMock.extractReferenceAudioToCos).toHaveBeenCalledWith(
      'signed:video/playground-runs/seedance-reference-task-1.mp4',
      'task-1',
    )
    const generateOptions = generatorMock.generateVideo.mock.calls.at(-1)?.[3] as Record<string, unknown>
    expect(generateOptions.referenceVideos).toEqual([
      'signed:video/playground-runs/seedance-reference-task-1.mp4',
    ])
  })

  it('深度影片正規化失敗 -> 不呼叫付費生成或音軌處理', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos.mockRejectedValue(
      new Error('SEEDANCE_REFERENCE_PROBE_DURATION_INVALID'),
    )

    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'follow the grayscale depth motion',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      preserveSourceAudio: true,
    }))).rejects.toThrow('SEEDANCE_REFERENCE_PROBE_DURATION_INVALID')

    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
    expect(utilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
  })

  it('要求保留原音但正規化結果沒有音軌 -> 付費生成前顯式失敗', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos.mockResolvedValue({
      cosKey: 'video/playground-runs/seedance-reference-task-1.mp4',
      probe: {
        formatNames: ['mov', 'mp4'],
        sizeBytes: 2_000_000,
        durationSec: 12,
        videoCodec: 'h264',
        width: 720,
        height: 1280,
        fps: 24,
        hasAudio: false,
      },
    })

    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'follow the grayscale depth motion',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      preserveSourceAudio: true,
    }))).rejects.toThrow(
      'PLAYGROUND_SOURCE_AUDIO_TRACK_MISSING_AFTER_NORMALIZATION',
    )

    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('深度正規化收到外部 HTTPS -> 在 ffprobe 與付費生成前顯式拒絕', async () => {
    referenceGuardMock.filterAuthorizedStorageReferences.mockResolvedValue({
      safe: [],
      rejected: ['https://attacker.example/depth.webm'],
    })

    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'rebuild',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['https://attacker.example/depth.webm'],
      normalizeSeedanceReferenceVideo: true,
    }))).rejects.toThrow(
      'PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_REFERENCE_NOT_TRUSTED',
    )

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('非白名單模型要求深度影片正規化 -> 在轉檔與付費生成前顯式失敗', async () => {
    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'rebuild',
      modelKey: 'fal::bytedance/seedance-2.0/reference-to-video',
      referenceVideos: ['cos/depth.webm'],
      normalizeSeedanceReferenceVideo: true,
    }))).rejects.toThrow('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_MODEL_UNSUPPORTED')

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })
})
