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
    sourceProbe: {
      width: 1920,
      height: 1080,
      durationSec: 12 as number | null,
    },
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
  probeSeedanceReferenceVideoSource: vi.fn(async () => ({
    width: 1920,
    height: 1080,
    durationSec: 12 as number | null,
  })),
}))

const referenceGuardMock = vi.hoisted(() => ({
  filterAuthorizedStorageReferences: vi.fn(async (refs: string[]) => ({
    safe: refs,
    rejected: [] as string[],
  })),
}))

const taskServiceMock = vi.hoisted(() => ({
  persistTaskExternalIdOrThrow: vi.fn(async () => undefined),
}))

vi.mock('@/lib/generator-api', () => generatorMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn() }))
vi.mock('@/lib/playground/source-audio', () => sourceAudioMock)
vi.mock('@/lib/playground/seedance-reference-video', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/playground/seedance-reference-video')>(),
  ...seedanceReferenceMock,
}))
vi.mock('@/lib/playground/reference-guard', () => referenceGuardMock)
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  createScopedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))
// 尾帧抽取走真实 ffmpeg + @/lib/cos(其 import 链会拉进未 mock 的模块),
// 单测里直接 mock 掉;续镜链行为由 canvas-refs 单测覆盖。
vi.mock('@/lib/video-tail-frame', () => ({
  extractVideoTailFrameToCos: vi.fn(async () => 'cos/tail-frame-key'),
}))

import { handlePlaygroundImageTask } from '@/lib/workers/handlers/playground-image'
import { handlePlaygroundVideoTask } from '@/lib/workers/handlers/playground-video'

function makeJob(payload: Record<string, unknown>): Job<TaskJobData> {
  const data: TaskJobData = {
      taskId: 'task-1',
      type: 'playground_image',
      locale: 'zh',
      projectId: 'playground',
      targetType: 'playground',
      targetId: 'task-1',
      userId: 'user-1',
      payload,
  }
  const job = {
    data,
    updateData: vi.fn(async (nextData: TaskJobData) => {
      job.data = nextData
    }),
  }
  return job as unknown as Job<TaskJobData>
}

function adaptiveGuidePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt: 'video 1 is complete depth; video 2 is critical RGB',
    modelKey: 'atlascloud::seedance-2.0-r2v',
    referenceVideos: ['cos/source-depth.webm', 'cos/source-rgb.mp4'],
    normalizeSeedanceReferenceVideo: true,
    sourceAudioMode: 'reference-only',
    duration: 12,
    resolution: '720p',
    aspectRatio: '16:9',
    sourceVideoKey: 'cos/source-rgb.mp4',
    depthRebuildGuideContract: {
      version: 2,
      strategy: 'full-depth-critical-rgb',
      sourceVideoKey: 'cos/source-rgb.mp4',
      sourceDurationSeconds: 11.2,
      outputDurationSeconds: 12,
      referenceVideoWindows: [
        { role: 'depth', startSeconds: 0, durationSeconds: 11.2 },
        { role: 'rgb', startSeconds: 4.6, durationSeconds: 3.3 },
      ],
    },
    ...overrides,
  }
}

function adaptiveNormalizedResult(input: {
  role: 'depth' | 'rgb'
  normalizedDuration: number
  sourceDuration: number | null
  width?: number
  height?: number
  fps?: number
}) {
  return {
    cosKey: `video/playground-runs/task-1-${input.role}.mp4`,
    sourceProbe: {
      width: 1920,
      height: 1080,
      durationSec: input.sourceDuration,
    },
    probe: {
      formatNames: ['mov', 'mp4'],
      sizeBytes: 1_000_000,
      durationSec: input.normalizedDuration,
      videoCodec: 'h264',
      width: input.width ?? 1280,
      height: input.height ?? 720,
      fps: input.fps ?? 24,
      hasAudio: false,
    },
  }
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
    taskServiceMock.persistTaskExternalIdOrThrow.mockResolvedValue(undefined)
    utilsMock.uploadVideoSourceToCos.mockResolvedValue('cos/video-key')
    utilsMock.toSignedUrlIfCos.mockImplementation((key: string) => `signed:${key}`)
    referenceGuardMock.filterAuthorizedStorageReferences.mockImplementation(async (refs: string[]) => ({
      safe: refs,
      rejected: [],
    }))
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos.mockResolvedValue({
      cosKey: 'video/playground-runs/seedance-reference-task-1.mp4',
      sourceProbe: {
        width: 1920,
        height: 1080,
        durationSec: 12,
      },
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
    seedanceReferenceMock.probeSeedanceReferenceVideoSource.mockResolvedValue({
      width: 1920,
      height: 1080,
      durationSec: 12,
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
    expect(taskServiceMock.persistTaskExternalIdOrThrow).toHaveBeenCalledWith(
      'task-1',
      'vid-1',
    )
    const submittedJob = utilsMock.waitExternalResult.mock.calls[0]?.[0] as Job<TaskJobData>
    expect(submittedJob.data.providerExternalId).toBe('vid-1')
    expect(
      taskServiceMock.persistTaskExternalIdOrThrow.mock.invocationCallOrder[0],
    ).toBeLessThan(utilsMock.waitExternalResult.mock.invocationCallOrder[0] ?? 0)
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://prov/clip.mp4',
      'playground-runs/task-1',
      'task-1',
      undefined,
    )
  })

  it('供應商已收件但 externalId 無法持久化 -> 停止輪詢與後續處理，避免 retry 重複付費', async () => {
    generatorMock.generateVideo.mockResolvedValue({
      success: true,
      externalId: 'ATLASCLOUD:VIDEO:paid-request',
    })
    taskServiceMock.persistTaskExternalIdOrThrow.mockRejectedValue(
      new Error('TASK_EXTERNAL_ID_PERSIST_FAILED'),
    )

    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'preserve the camera motion',
      modelKey: 'atlascloud::seedance-2.0-r2v',
    }))).rejects.toThrow('TASK_EXTERNAL_ID_PERSIST_FAILED')

    expect(taskServiceMock.persistTaskExternalIdOrThrow).toHaveBeenCalledWith(
      'task-1',
      'ATLASCLOUD:VIDEO:paid-request',
    )
    expect(utilsMock.waitExternalResult).not.toHaveBeenCalled()
    expect(utilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
  })

  it('provider 回傳後 DB 暫時失敗 -> queue retry 從 BullMQ externalId 恢復且不重複付費', async () => {
    generatorMock.generateVideo.mockResolvedValue({
      success: true,
      externalId: 'ATLASCLOUD:VIDEO:paid-request',
    })
    taskServiceMock.persistTaskExternalIdOrThrow
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(undefined)
    utilsMock.waitExternalResult.mockResolvedValue({ url: 'https://prov/resumed.mp4' })
    const payload = {
      prompt: 'preserve the camera motion',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      meta: {
        workflowId: 'workflow-keep',
        segmentIndex: 0,
      },
    }
    const job = makeJob(payload)

    const firstAttempt = handlePlaygroundVideoTask(job)
    await expect(firstAttempt).rejects.toMatchObject({
      message: 'database unavailable',
      code: 'WORKER_EXECUTION_ERROR',
    })
    expect(job.data.providerExternalId).toBe('ATLASCLOUD:VIDEO:paid-request')
    expect(job.data.payload).toEqual(payload)
    expect(utilsMock.waitExternalResult).not.toHaveBeenCalled()

    const result = await handlePlaygroundVideoTask(job)

    expect(result).toEqual({
      resultUrls: ['cos/video-key'],
      tailFrameKey: 'cos/tail-frame-key',
    })
    expect(generatorMock.generateVideo).toHaveBeenCalledTimes(1)
    expect(utilsMock.getTaskExistingExternalId).toHaveBeenCalledTimes(1)
    expect(taskServiceMock.persistTaskExternalIdOrThrow).toHaveBeenLastCalledWith(
      'task-1',
      'ATLASCLOUD:VIDEO:paid-request',
    )
    expect(utilsMock.waitExternalResult).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerExternalId: 'ATLASCLOUD:VIDEO:paid-request',
        }),
      }),
      'ATLASCLOUD:VIDEO:paid-request',
      'user-1',
      expect.objectContaining({ progressStart: 30, progressEnd: 90 }),
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

  it('RGB＋Depth 已有 externalId 的 retry -> 不重做兩支影片正規化', async () => {
    utilsMock.getTaskExistingExternalId.mockResolvedValue('ATLASCLOUD:VIDEO:dual-existing')
    utilsMock.waitExternalResult.mockResolvedValue({ url: 'https://prov/resumed-dual.mp4' })

    await handlePlaygroundVideoTask(makeJob({
      prompt: 'resume dual guide',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source-rgb.mp4', 'cos/source-depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      depthRebuildDualGuide: true,
      workflowId: 'workflow_retry',
      segmentIndex: 0,
      segmentCount: 2,
      referenceVideoWindow: { startSeconds: 0, durationSeconds: 5.5 },
      duration: 5.5,
      resolution: '720p',
      aspectRatio: '16:9',
      sourceAudioMode: 'reference-only',
    }))

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
    expect(utilsMock.waitExternalResult).toHaveBeenCalledWith(
      expect.anything(),
      'ATLASCLOUD:VIDEO:dual-existing',
      'user-1',
      expect.any(Object),
    )
  })

  it('RGB＋Depth 的秒數與同步窗不一致 -> 正規化前失敗', async () => {
    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'dual guide',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source-rgb.mp4', 'cos/source-depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      depthRebuildDualGuide: true,
      workflowId: 'workflow_1',
      segmentIndex: 0,
      segmentCount: 2,
      referenceVideoWindow: { startSeconds: 0, durationSeconds: 5.5 },
      duration: 5.4,
      resolution: '720p',
      aspectRatio: '16:9',
      sourceAudioMode: 'reference-only',
    }))).rejects.toThrow('PLAYGROUND_DEPTH_REBUILD_DUAL_GUIDE_CONTRACT_INVALID')

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('一般影片任務夾帶工作流分段身分 -> 顯式拒絕', async () => {
    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'ordinary task',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      workflowId: 'workflow_1',
      segmentIndex: 0,
      segmentCount: 1,
    }))).rejects.toThrow('PLAYGROUND_DEPTH_REBUILD_SEGMENT_IDENTITY_REQUIRES_DUAL_GUIDE')

    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
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
      sourceProbe: {
        width: 1920,
        height: 1080,
        durationSec: 12,
      },
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

  it('本機 /api/files 參考 -> 轉成 ffmpeg 可取得的絕對網址再正規化', async () => {
    utilsMock.toSignedUrlIfCos.mockImplementation((key: string) => `/api/files/${key}`)
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos.mockResolvedValue({
      cosKey: 'video/playground-runs/normalized.mp4',
      sourceProbe: {
        width: 1920,
        height: 1080,
        durationSec: 5,
      },
      probe: {
        formatNames: ['mov', 'mp4'],
        sizeBytes: 1_000_000,
        durationSec: 5,
        videoCodec: 'h264',
        width: 1280,
        height: 720,
        fps: 24,
        hasAudio: false,
      },
    })
    generatorMock.generateVideo.mockResolvedValue({ success: true, externalId: 'vid-local-ref' })
    utilsMock.waitExternalResult.mockResolvedValue({ url: 'https://prov/result.mp4' })

    await handlePlaygroundVideoTask(makeJob({
      prompt: 'local reference',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['video/playground-ref/user-1/source.mp4'],
      normalizeSeedanceReferenceVideo: true,
      sourceAudioMode: 'generate',
    }))

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).toHaveBeenCalledWith({
      sourceVideoUrl: 'http://localhost:3000/api/files/video/playground-ref/user-1/source.mp4',
      taskId: 'task-1',
      requireAudio: false,
      sourceAudioMode: 'generate',
    })
  })

  it('RGB＋Depth -> 依序正規化 RGB 再 Depth，且音訊只能取自 RGB', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos
      .mockResolvedValueOnce({
        cosKey: 'video/playground-runs/task-1-rgb.mp4',
        sourceProbe: {
          width: 1920,
          height: 1080,
          durationSec: 5.5,
        },
        probe: {
          formatNames: ['mov', 'mp4'],
          sizeBytes: 2_000_000,
          durationSec: 5.5,
          videoCodec: 'h264',
          width: 1280,
          height: 720,
          fps: 24,
          hasAudio: true,
        },
      })
      .mockResolvedValueOnce({
        cosKey: 'video/playground-runs/task-1-depth.mp4',
        sourceProbe: {
          width: 1920,
          height: 1080,
          durationSec: null,
        },
        probe: {
          formatNames: ['mov', 'mp4'],
          sizeBytes: 1_200_000,
          durationSec: 5.5,
          videoCodec: 'h264',
          width: 1280,
          height: 720,
          fps: 24,
          hasAudio: false,
        },
      })
    generatorMock.generateVideo.mockResolvedValue({
      success: true,
      externalId: 'vid-dual-guide',
    })
    utilsMock.waitExternalResult.mockResolvedValue({
      url: 'https://prov/generated-dual-guide.mp4',
      downloadHeaders: { Authorization: 'Bearer generated' },
    })

    await handlePlaygroundVideoTask(makeJob({
      prompt: 'video 1 controls RGB motion; video 2 controls depth geometry',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source-rgb.mp4', 'cos/source-depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      depthRebuildDualGuide: true,
      workflowId: 'workflow_1',
      segmentIndex: 0,
      segmentCount: 2,
      referenceVideoWindow: { startSeconds: 0, durationSeconds: 5.5 },
      duration: 5.5,
      resolution: '720p',
      aspectRatio: '16:9',
      sourceAudioMode: 'reference-only',
    }))

    expect(referenceGuardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      ['cos/source-rgb.mp4', 'cos/source-depth.webm'],
      'user-1',
    )
    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).toHaveBeenNthCalledWith(1, {
      sourceVideoUrl: 'signed:cos/source-rgb.mp4',
      taskId: 'task-1',
      requireAudio: true,
      sourceAudioMode: 'reference-only',
      trim: { startSeconds: 0, durationSeconds: 5.5 },
      outputId: 'rgb',
    })
    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).toHaveBeenNthCalledWith(2, {
      sourceVideoUrl: 'signed:cos/source-depth.webm',
      taskId: 'task-1',
      sourceAudioMode: 'generate',
      trim: { startSeconds: 0, durationSeconds: 5.5 },
      outputId: 'depth',
    })
    const [rgbNormalizeOrder, depthNormalizeOrder] =
      seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos.mock.invocationCallOrder
    const [audioExtractOrder] = sourceAudioMock.extractReferenceAudioToCos.mock.invocationCallOrder
    expect(rgbNormalizeOrder).toBeLessThan(depthNormalizeOrder)
    expect(depthNormalizeOrder).toBeLessThan(audioExtractOrder)
    expect(sourceAudioMock.extractReferenceAudioToCos).toHaveBeenCalledOnce()
    expect(sourceAudioMock.extractReferenceAudioToCos).toHaveBeenCalledWith(
      'signed:video/playground-runs/task-1-rgb.mp4',
      'task-1',
    )
    const options = generatorMock.generateVideo.mock.calls.at(-1)?.[3] as Record<string, unknown>
    expect(options).toMatchObject({
      generateAudio: false,
      referenceVideos: [
        'signed:video/playground-runs/task-1-rgb.mp4',
        'signed:video/playground-runs/task-1-depth.mp4',
      ],
      referenceAudios: ['signed:cos/source-audio.mp3'],
    })
    expect(sourceAudioMock.muxGeneratedVideoWithSourceAudio).not.toHaveBeenCalled()
    expect(sourceAudioMock.stripGeneratedVideoAudio).toHaveBeenCalledWith({
      generatedVideoUrl: 'https://prov/generated-dual-guide.mp4',
      generatedDownloadHeaders: { Authorization: 'Bearer generated' },
    })
    expect(JSON.stringify(sourceAudioMock.extractReferenceAudioToCos.mock.calls))
      .not.toContain('task-1-depth.mp4')
    expect(JSON.stringify(sourceAudioMock.stripGeneratedVideoAudio.mock.calls))
      .not.toContain('task-1-depth.mp4')
  })

  it('v2 1920×1080 RGB＋518×294 Depth -> 共用 1280×720、Depth-first 且只送一次 provider', async () => {
    seedanceReferenceMock.probeSeedanceReferenceVideoSource.mockResolvedValue({
      width: 1920,
      height: 1080,
      durationSec: 11.2,
    })
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos
      .mockResolvedValueOnce({
        cosKey: 'video/playground-runs/task-1-depth.mp4',
        sourceProbe: {
          width: 518,
          height: 294,
          durationSec: null,
        },
        probe: {
          formatNames: ['mov', 'mp4'],
          sizeBytes: 2_000_000,
          durationSec: 11.2,
          videoCodec: 'h264',
          width: 1280,
          height: 720,
          fps: 24,
          hasAudio: false,
        },
      })
      .mockResolvedValueOnce({
        cosKey: 'video/playground-runs/task-1-rgb.mp4',
        sourceProbe: {
          width: 1920,
          height: 1080,
          durationSec: 11.2,
        },
        probe: {
          formatNames: ['mov', 'mp4'],
          sizeBytes: 800_000,
          durationSec: 3.3,
          videoCodec: 'h264',
          width: 1280,
          height: 720,
          fps: 24,
          hasAudio: false,
        },
      })
    generatorMock.generateVideo.mockResolvedValue({
      success: true,
      externalId: 'vid-adaptive-guide-v2',
    })
    utilsMock.waitExternalResult.mockResolvedValue({
      url: 'https://prov/generated-adaptive-v2.mp4',
      downloadHeaders: { Authorization: 'Bearer generated' },
    })

    await handlePlaygroundVideoTask(makeJob(adaptiveGuidePayload()))

    expect(referenceGuardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      ['cos/source-depth.webm', 'cos/source-rgb.mp4'],
      'user-1',
    )
    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos)
      .toHaveBeenNthCalledWith(1, {
        sourceVideoUrl: 'signed:cos/source-depth.webm',
        taskId: 'task-1',
        sourceAudioMode: 'generate',
        trim: { startSeconds: 0, durationSeconds: 11.2 },
        outputId: 'depth',
        targetDimensions: { width: 1280, height: 720 },
      })
    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos)
      .toHaveBeenNthCalledWith(2, {
        sourceVideoUrl: 'signed:cos/source-rgb.mp4',
        taskId: 'task-1',
        sourceAudioMode: 'generate',
        trim: { startSeconds: 4.6, durationSeconds: 3.3 },
        outputId: 'rgb',
        targetDimensions: { width: 1280, height: 720 },
      })
    expect(sourceAudioMock.extractReferenceAudioToCos).toHaveBeenCalledWith(
      'signed:cos/source-rgb.mp4',
      'task-1',
    )
    expect(seedanceReferenceMock.probeSeedanceReferenceVideoSource).toHaveBeenCalledOnce()
    expect(seedanceReferenceMock.probeSeedanceReferenceVideoSource).toHaveBeenCalledWith(
      'signed:cos/source-rgb.mp4',
    )
    const options = generatorMock.generateVideo.mock.calls.at(-1)?.[3] as Record<string, unknown>
    expect(options).toMatchObject({
      duration: 12,
      generateAudio: false,
      referenceVideos: [
        'signed:video/playground-runs/task-1-depth.mp4',
        'signed:video/playground-runs/task-1-rgb.mp4',
      ],
      referenceAudios: ['signed:cos/source-audio.mp3'],
    })
    expect(generatorMock.generateVideo).toHaveBeenCalledTimes(1)
    expect(sourceAudioMock.muxGeneratedVideoWithSourceAudio).not.toHaveBeenCalled()
    expect(sourceAudioMock.stripGeneratedVideoAudio).toHaveBeenCalledWith({
      generatedVideoUrl: 'https://prov/generated-adaptive-v2.mp4',
      generatedDownloadHeaders: { Authorization: 'Bearer generated' },
    })
  })

  it('v2 名義 11.2＋3.3 秒、24fps 轉碼後約 14.541 秒 -> 仍只送出一次 provider', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'depth',
        normalizedDuration: 11.208,
        sourceDuration: 11.2,
      }))
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'rgb',
        normalizedDuration: 3.333,
        sourceDuration: 11.2,
      }))
    generatorMock.generateVideo.mockResolvedValue({
      success: true,
      externalId: 'vid-adaptive-frame-rounded',
    })
    utilsMock.waitExternalResult.mockResolvedValue({
      url: 'https://prov/generated-frame-rounded.mp4',
      downloadHeaders: { Authorization: 'Bearer generated' },
    })

    await handlePlaygroundVideoTask(makeJob(adaptiveGuidePayload()))

    expect(generatorMock.generateVideo).toHaveBeenCalledTimes(1)
    expect(generatorMock.generateVideo).toHaveBeenCalledWith(
      'user-1',
      'atlascloud::seedance-2.0-r2v',
      '',
      expect.objectContaining({
        duration: 12,
        referenceVideos: [
          'signed:video/playground-runs/task-1-depth.mp4',
          'signed:video/playground-runs/task-1-rgb.mp4',
        ],
      }),
    )
    expect(utilsMock.waitExternalResult).toHaveBeenCalledWith(
      expect.anything(),
      'vid-adaptive-frame-rounded',
      'user-1',
      expect.any(Object),
    )
  })

  it(
    'v2 reference-only 已有 externalId 的 retry -> 不重做前處理、不重送 provider',
    async () => {
      utilsMock.getTaskExistingExternalId.mockResolvedValue(
        'ATLASCLOUD:VIDEO:adaptive-existing',
      )
      utilsMock.waitExternalResult.mockResolvedValue({
        url: 'https://prov/resumed-adaptive-v2.mp4',
        downloadHeaders: { Authorization: 'Bearer generated' },
      })

      await handlePlaygroundVideoTask(makeJob(adaptiveGuidePayload()))

      expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
      expect(seedanceReferenceMock.probeSeedanceReferenceVideoSource).not.toHaveBeenCalled()
      expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
      expect(generatorMock.generateVideo).not.toHaveBeenCalled()
      expect(utilsMock.waitExternalResult).toHaveBeenCalledWith(
        expect.anything(),
        'ATLASCLOUD:VIDEO:adaptive-existing',
        'user-1',
        expect.any(Object),
      )
      expect(sourceAudioMock.stripGeneratedVideoAudio).toHaveBeenCalledWith({
        generatedVideoUrl: 'https://prov/resumed-adaptive-v2.mp4',
        generatedDownloadHeaders: { Authorization: 'Bearer generated' },
      })
      expect(sourceAudioMock.muxGeneratedVideoWithSourceAudio).not.toHaveBeenCalled()
      expect(JSON.stringify(sourceAudioMock.stripGeneratedVideoAudio.mock.calls))
        .not.toContain('source-depth.webm')
    },
  )

  it('v2 preserve -> worker fail closed，不做正規化或付費送單', async () => {
    await expect(handlePlaygroundVideoTask(makeJob(adaptiveGuidePayload({
      sourceAudioMode: 'preserve',
    })))).rejects.toThrow('PLAYGROUND_DEPTH_REBUILD_GUIDE_CONTRACT_INVALID')

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('v2 15 秒 Depth-only + generate -> provider 只收到完整 Depth，不抽取來源音訊', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos.mockResolvedValueOnce({
      cosKey: 'video/playground-runs/task-1-depth-only.mp4',
      sourceProbe: {
        width: 1920,
        height: 1080,
        durationSec: null,
      },
      probe: {
        formatNames: ['mov', 'mp4'],
        sizeBytes: 2_000_000,
        durationSec: 15,
        videoCodec: 'h264',
        width: 1280,
        height: 720,
        fps: 24,
        hasAudio: false,
      },
    })
    generatorMock.generateVideo.mockResolvedValue({ success: true, externalId: 'vid-depth-only' })
    utilsMock.waitExternalResult.mockResolvedValue({ url: 'https://prov/depth-only.mp4' })
    seedanceReferenceMock.probeSeedanceReferenceVideoSource.mockResolvedValue({
      width: 1920,
      height: 1080,
      durationSec: 15,
    })

    await handlePlaygroundVideoTask(makeJob(adaptiveGuidePayload({
      referenceVideos: ['cos/source-depth.webm'],
      sourceAudioMode: 'generate',
      duration: 15,
      depthRebuildGuideContract: {
        version: 2,
        strategy: 'full-depth-only',
        sourceVideoKey: 'cos/source-rgb.mp4',
        sourceDurationSeconds: 15,
        outputDurationSeconds: 15,
        referenceVideoWindows: [
          { role: 'depth', startSeconds: 0, durationSeconds: 15 },
        ],
      },
    })))

    expect(referenceGuardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      ['cos/source-depth.webm', 'cos/source-rgb.mp4'],
      'user-1',
    )
    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).toHaveBeenCalledWith({
      sourceVideoUrl: 'signed:cos/source-depth.webm',
      taskId: 'task-1',
      sourceAudioMode: 'generate',
      trim: { startSeconds: 0, durationSeconds: 15 },
      outputId: 'depth',
      targetDimensions: { width: 1280, height: 720 },
    })
    expect(seedanceReferenceMock.probeSeedanceReferenceVideoSource).toHaveBeenCalledWith(
      'signed:cos/source-rgb.mp4',
    )
    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    const options = generatorMock.generateVideo.mock.calls.at(-1)?.[3] as Record<string, unknown>
    expect(options.referenceVideos).toEqual([
      'signed:video/playground-runs/task-1-depth-only.mp4',
    ])
    expect(options.generateAudio).toBe(true)
  })

  it('v2 正規化後 probe 與 trim 不一致 -> fail closed，不送付費 provider', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos
      .mockResolvedValueOnce({
        cosKey: 'video/playground-runs/task-1-depth.mp4',
        sourceProbe: {
          width: 1920,
          height: 1080,
          durationSec: 11.2,
        },
        probe: {
          formatNames: ['mov', 'mp4'],
          sizeBytes: 2_000_000,
          durationSec: 10.9,
          videoCodec: 'h264',
          width: 1280,
          height: 720,
          fps: 24,
          hasAudio: false,
        },
      })
      .mockResolvedValueOnce({
        cosKey: 'video/playground-runs/task-1-rgb.mp4',
        sourceProbe: {
          width: 1920,
          height: 1080,
          durationSec: 11.2,
        },
        probe: {
          formatNames: ['mov', 'mp4'],
          sizeBytes: 800_000,
          durationSec: 3.3,
          videoCodec: 'h264',
          width: 1280,
          height: 720,
          fps: 24,
          hasAudio: false,
        },
      })

    await expect(handlePlaygroundVideoTask(
      makeJob(adaptiveGuidePayload()),
    )).rejects.toThrow(
      'PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_DURATION_MISMATCH',
    )

    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('v2 contract 低報原片秒數 -> raw Depth/RGB probe 不符時付費前 fail closed', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'depth',
        normalizedDuration: 11.2,
        sourceDuration: 12,
      }))
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'rgb',
        normalizedDuration: 3.3,
        sourceDuration: 12,
      }))

    await expect(handlePlaygroundVideoTask(
      makeJob(adaptiveGuidePayload()),
    )).rejects.toThrow(
      'PLAYGROUND_DEPTH_REBUILD_GUIDE_RGB_SOURCE_DURATION_MISMATCH',
    )

    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('v2 RGB 原片缺 duration metadata -> 付費前 fail closed', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'depth',
        normalizedDuration: 11.2,
        sourceDuration: null,
      }))
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'rgb',
        normalizedDuration: 3.3,
        sourceDuration: null,
      }))

    await expect(handlePlaygroundVideoTask(
      makeJob(adaptiveGuidePayload()),
    )).rejects.toThrow(
      'PLAYGROUND_DEPTH_REBUILD_GUIDE_RGB_SOURCE_DURATION_MISSING',
    )

    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('v2 raw Depth/RGB 各自在容差內但彼此未對齊 -> 付費前 fail closed', async () => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'depth',
        normalizedDuration: 11.2,
        sourceDuration: 11.1,
      }))
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'rgb',
        normalizedDuration: 3.3,
        sourceDuration: 11.3,
      }))

    await expect(handlePlaygroundVideoTask(
      makeJob(adaptiveGuidePayload()),
    )).rejects.toThrow(
      'PLAYGROUND_DEPTH_REBUILD_GUIDE_SOURCE_DURATION_ALIGNMENT_MISMATCH',
    )

    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: '尺寸不同',
      rgbOverrides: { width: 720, height: 1280 },
      error: 'PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_GEOMETRY_MISMATCH',
    },
    {
      label: 'fps 不同',
      rgbOverrides: { fps: 25 },
      error: 'PLAYGROUND_DEPTH_REBUILD_GUIDE_NORMALIZED_FPS_MISMATCH',
    },
  ])('v2 正規化後 $label -> 付費前 fail closed', async ({ rgbOverrides, error }) => {
    seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'depth',
        normalizedDuration: 11.2,
        sourceDuration: 11.2,
      }))
      .mockResolvedValueOnce(adaptiveNormalizedResult({
        role: 'rgb',
        normalizedDuration: 3.3,
        sourceDuration: 11.2,
        ...rgbOverrides,
      }))

    await expect(handlePlaygroundVideoTask(
      makeJob(adaptiveGuidePayload()),
    )).rejects.toThrow(error)

    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('v2 sourceVideoKey 未授權 -> 正規化與付費 provider 前失敗', async () => {
    referenceGuardMock.filterAuthorizedStorageReferences.mockResolvedValue({
      safe: ['cos/source-depth.webm'],
      rejected: ['cos/source-rgb.mp4'],
    })

    await expect(handlePlaygroundVideoTask(
      makeJob(adaptiveGuidePayload()),
    )).rejects.toThrow(
      'PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_REFERENCE_NOT_TRUSTED',
    )

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('RGB＋Depth 的任一 storage 參考未授權 -> 正規化與付費生成前失敗', async () => {
    referenceGuardMock.filterAuthorizedStorageReferences.mockResolvedValue({
      safe: ['cos/source-rgb.mp4'],
      rejected: ['cos/other-user-depth.webm'],
    })

    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'dual guide',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source-rgb.mp4', 'cos/other-user-depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      depthRebuildDualGuide: true,
      workflowId: 'workflow_1',
      segmentIndex: 0,
      segmentCount: 2,
      referenceVideoWindow: { startSeconds: 0, durationSeconds: 5.5 },
      duration: 5.5,
      resolution: '720p',
      aspectRatio: '16:9',
      sourceAudioMode: 'reference-only',
    }))).rejects.toThrow(
      'PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_REFERENCE_NOT_TRUSTED',
    )

    expect(referenceGuardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      ['cos/source-rgb.mp4', 'cos/other-user-depth.webm'],
      'user-1',
    )
    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: '缺少同步窗',
      referenceVideoWindow: undefined,
    },
    {
      label: '雙參考總長超過 15 秒',
      referenceVideoWindow: { startSeconds: 0, durationSeconds: 7.51 },
    },
    {
      label: '同步窗結束點超過 15 秒',
      referenceVideoWindow: { startSeconds: 10, durationSeconds: 5.5 },
    },
  ])('RGB＋Depth $label -> 正規化與付費生成前失敗', async ({ referenceVideoWindow }) => {
    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'dual guide',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['cos/source-rgb.mp4', 'cos/source-depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      depthRebuildDualGuide: true,
      workflowId: 'workflow_1',
      segmentIndex: 0,
      segmentCount: 2,
      ...(referenceVideoWindow ? { referenceVideoWindow } : {}),
      duration: referenceVideoWindow?.durationSeconds ?? 5.5,
      resolution: '720p',
      aspectRatio: '16:9',
      sourceAudioMode: 'reference-only',
    }))).rejects.toThrow('PLAYGROUND_DEPTH_REBUILD_DUAL_GUIDE_CONTRACT_INVALID')

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(sourceAudioMock.extractReferenceAudioToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
  })

  it('RGB＋Depth + 非 Atlas Seedance 模型 -> 轉檔與付費生成前失敗', async () => {
    await expect(handlePlaygroundVideoTask(makeJob({
      prompt: 'dual guide',
      modelKey: 'fal::bytedance/seedance-2.0/reference-to-video',
      referenceVideos: ['cos/source-rgb.mp4', 'cos/source-depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      depthRebuildDualGuide: true,
      workflowId: 'workflow_1',
      segmentIndex: 0,
      segmentCount: 2,
      referenceVideoWindow: { startSeconds: 0, durationSeconds: 5.5 },
      duration: 5.5,
      resolution: '720p',
      aspectRatio: '16:9',
      sourceAudioMode: 'reference-only',
    }))).rejects.toThrow('PLAYGROUND_SEEDANCE_REFERENCE_NORMALIZATION_MODEL_UNSUPPORTED')

    expect(seedanceReferenceMock.normalizeSeedanceReferenceVideoToCos).not.toHaveBeenCalled()
    expect(generatorMock.generateVideo).not.toHaveBeenCalled()
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
      sourceProbe: {
        width: 1920,
        height: 1080,
        durationSec: 12,
      },
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
