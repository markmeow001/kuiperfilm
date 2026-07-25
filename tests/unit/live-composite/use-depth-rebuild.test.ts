// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DepthGuideRecordingCancelledError,
  type DepthGuideProgress,
  type DepthGuideRecordingResult,
} from '@/app/[locale]/live-composite/lib/depth-guide-recorder'
import {
  useDepthRebuild,
  type DepthGuideStageHandle,
} from '@/app/[locale]/live-composite/useDepthRebuild'

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  submit: vi.fn(),
  waitForTaskResult: vi.fn(),
  requestJsonWithError: vi.fn(),
  createObjectUrl: vi.fn(),
  revokeObjectUrl: vi.fn(),
  videoModels: [] as Array<{ value: string; label: string }>,
  costEstimate: { amountUsd: 1.25 as number | null, unit: 'capability' as const },
}))

vi.mock('@/lib/query/hooks/useUserModels', () => ({
  useUserModels: () => ({
    data: {
      video: mocks.videoModels,
    },
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/lib/query/mutations/playground-mutations', () => ({
  useUploadPlaygroundReference: () => ({ mutateAsync: mocks.upload }),
  useSubmitPlaygroundRun: () => ({ mutateAsync: mocks.submit }),
  usePlaygroundCostEstimate: () => ({
    data: mocks.costEstimate,
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/lib/query/mutations/mutation-shared', () => ({
  requestJsonWithError: mocks.requestJsonWithError,
}))

vi.mock('@/lib/task/client', () => ({
  waitForTaskResult: mocks.waitForTaskResult,
}))

const metadata = {
  width: 1920,
  height: 1080,
  duration: 12,
  name: 'performance.mp4',
}

function completedDepthResult(): DepthGuideRecordingResult {
  return {
    blob: new Blob(['depth'], { type: 'video/webm' }),
    mimeType: 'video/webm',
    extension: 'webm',
    depthFrameCount: 144,
    effectiveDepthFps: 12,
    sufficient: true,
  }
}

function createStage(
  exportDepthGuideVideo: DepthGuideStageHandle['exportDepthGuideVideo'] = async ({ onProgress }) => {
    onProgress({
      phase: 'recording',
      completedFrames: 144,
      totalFrames: 144,
      currentTime: 12,
      duration: 12,
      message: '深度影片完成',
    })
    return completedDepthResult()
  },
): DepthGuideStageHandle {
  return {
    exportDepthGuideVideo: vi.fn(exportDepthGuideVideo),
    cancelDepthGuideVideo: vi.fn(),
  }
}

describe('useDepthRebuild', () => {
  beforeEach(() => {
    mocks.videoModels.splice(0, mocks.videoModels.length,
      {
        value: 'atlascloud::seedance-2.0-r2v',
        label: 'Seedance 2.0 Standard R2V',
      },
      {
        value: 'atlascloud::seedance-2.0-fast-r2v',
        label: 'Seedance 2.0 Fast R2V',
      })
    mocks.costEstimate = { amountUsd: 1.25, unit: 'capability' }
    mocks.upload.mockImplementation(async ({ file, type }: { file: File; type: string }) => ({
      success: true,
      key: `${type}/${file.name}`,
      signedUrl: `https://media.example/${file.name}`,
    }))
    mocks.submit.mockResolvedValue({
      success: true,
      run: {
        id: 'run-depth-1',
        status: 'pending',
        resultUrl: null,
        outputType: 'video',
        modelKey: 'atlascloud::seedance-2.0-r2v',
        createdAt: '2026-07-24T00:00:00.000Z',
        completedAt: null,
      },
    })
    mocks.waitForTaskResult.mockResolvedValue({
      resultUrls: ['video/result.mp4'],
    })
    mocks.requestJsonWithError.mockResolvedValue({
      run: {
        id: 'run-depth-1',
        status: 'succeeded',
        resultUrls: ['https://media.example/result.mp4'],
      },
    })
    mocks.createObjectUrl.mockImplementation((file: File) => `blob:${file.name}`)
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: mocks.createObjectUrl,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: mocks.revokeObjectUrl,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('只建立本機深度片與 Prompt -> 不上傳、不提交付費任務', async () => {
    const stage = createStage()
    const stageRef = { current: stage }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: true,
    }))

    act(() => {
      result.current.selectCharacterImage(new File(['character'], 'character.png', { type: 'image/png' }))
      result.current.selectSceneImage(new File(['scene'], 'scene.jpg', { type: 'image/jpeg' }))
      result.current.setCharacterDescription('寫實民國女演員，短髮，灰色旗袍')
      result.current.setSceneDescription('上海雨夜街道，車流與招牌持續運動')
    })
    await act(async () => {
      await result.current.generateDepthGuide()
    })
    act(() => result.current.buildPrompt())

    expect(stage.exportDepthGuideVideo).toHaveBeenCalledWith({
      includeAudio: true,
      onProgress: expect.any(Function),
    })
    expect(result.current.depthGuide?.effectiveDepthFps).toBe(12)
    expect(result.current.prompt).toContain('video 1 = grayscale inverse-depth performance guide')
    expect(result.current.prompt).toContain('image 1 = the only identity')
    expect(result.current.prompt).toContain('image 2 = new environment')
    expect(result.current.promptIsStale).toBe(false)
    expect(result.current.canGenerate).toBe(true)
    expect(mocks.upload).toHaveBeenCalledTimes(0)
    expect(mocks.submit).toHaveBeenCalledTimes(0)
  })

  it('明確按下生成 -> 只送一支 depth video，圖片固定 character、scene 順序並保留原音', async () => {
    const stage = createStage()
    const stageRef = { current: stage }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: true,
      workspaceId: 'workspace-1',
    }))

    act(() => {
      result.current.selectCharacterImage(new File(['character'], 'character.png', { type: 'image/png' }))
      result.current.selectSceneImage(new File(['scene'], 'scene.jpg', { type: 'image/jpeg' }))
      result.current.setCharacterDescription('寫實民國女演員，短髮，灰色旗袍')
      result.current.setSceneDescription('上海雨夜街道，車流與招牌持續運動')
    })
    await act(async () => {
      await result.current.generateDepthGuide()
    })
    act(() => result.current.buildPrompt())
    const reviewedPrompt = result.current.prompt

    let generated = null
    await act(async () => {
      generated = await result.current.generate()
    })

    const uploadCalls = mocks.upload.mock.calls.map(([input]) => ({
      type: input.type as string,
      name: (input.file as File).name,
    }))
    expect(uploadCalls).toEqual([
      { type: 'video', name: expect.stringMatching(/^depth-guide-\d+\.webm$/) },
      { type: 'image', name: 'character.png' },
      { type: 'image', name: 'scene.jpg' },
    ])
    expect(mocks.submit).toHaveBeenCalledWith({
      prompt: reviewedPrompt,
      referenceVideos: [expect.stringMatching(/^video\/depth-guide-\d+\.webm$/)],
      referenceImages: ['image/character.png', 'image/scene.jpg'],
      referenceImageNames: ['新角色', '新場景'],
      outputType: 'video',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      resolution: '720p',
      normalizeSeedanceReferenceVideo: true,
      aspectRatio: '16:9',
      durationSec: 12,
      generateAudio: false,
      preserveSourceAudio: true,
      workspaceId: 'workspace-1',
      idempotencyKey: expect.any(String),
      signal: expect.any(AbortSignal),
    })
    expect(mocks.waitForTaskResult.mock.calls[0]?.[0]).toBe('run-depth-1')
    expect(mocks.requestJsonWithError.mock.calls[0]?.[0]).toBe('/api/playground/runs/run-depth-1')
    expect(generated).toEqual({
      runId: 'run-depth-1',
      url: 'https://media.example/result.mp4',
    })
    expect(result.current.generationStatus).toBe('succeeded')
    expect(result.current.generationProgress).toBe(100)
    expect(result.current.submittedRunId).toBe('run-depth-1')
    expect(result.current.canResume).toBe(false)
  })

  it('提交成功後輪詢與結果查詢暫時失敗 -> 再按生成只恢復同一 run，不重複上傳或提交', async () => {
    mocks.waitForTaskResult.mockRejectedValueOnce(new Error('暫時無法輪詢任務'))
    mocks.requestJsonWithError
      .mockRejectedValueOnce(new Error('暫時無法讀取任務'))
      .mockResolvedValue({
        run: {
          id: 'run-depth-1',
          status: 'succeeded',
          resultUrls: ['https://media.example/recovered.mp4'],
        },
      })
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))
    act(() => {
      result.current.selectCharacterImage(new File(['character'], 'character.png', { type: 'image/png' }))
      result.current.setCharacterDescription('寫實電影角色')
      result.current.setSceneDescription('雨夜街道持續有車流')
    })
    await act(async () => {
      await result.current.generateDepthGuide()
    })
    act(() => result.current.buildPrompt())

    await act(async () => {
      await result.current.generate()
    })

    expect(result.current.generationStatus).toBe('failed')
    expect(result.current.submittedRunId).toBe('run-depth-1')
    expect(result.current.canResume).toBe(true)
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.submit).toHaveBeenCalledTimes(1)

    let recovered = null
    await act(async () => {
      recovered = await result.current.generate()
    })

    expect(recovered).toEqual({
      runId: 'run-depth-1',
      url: 'https://media.example/recovered.mp4',
    })
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(mocks.waitForTaskResult).toHaveBeenCalledTimes(1)
    expect(mocks.requestJsonWithError.mock.calls.map(([url]) => url)).toEqual([
      '/api/playground/runs/run-depth-1',
      '/api/playground/runs/run-depth-1',
    ])
  })

  it('供應商任務終端失敗 -> 明確顯示失敗且再次生成不建立新任務', async () => {
    mocks.waitForTaskResult.mockRejectedValueOnce(new Error('Task failed'))
    mocks.requestJsonWithError.mockResolvedValue({
      run: {
        id: 'run-depth-1',
        status: 'failed',
        resultUrls: null,
        errorMessage: 'provider rejected reference video',
      },
    })
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))
    act(() => {
      result.current.selectCharacterImage(new File(['character'], 'character.png', { type: 'image/png' }))
      result.current.setCharacterDescription('寫實電影角色')
      result.current.setSceneDescription('雨夜街道持續有車流')
    })
    await act(async () => {
      await result.current.generateDepthGuide()
    })
    act(() => result.current.buildPrompt())

    await act(async () => {
      await result.current.generate()
    })

    expect(result.current.error).toBe('深度重建供應商執行失敗：provider rejected reference video')
    expect(result.current.submittedRunId).toBe('run-depth-1')
    expect(result.current.canResume).toBe(false)

    await act(async () => {
      await result.current.generate()
    })

    expect(result.current.error).toBe('深度重建供應商執行失敗：provider rejected reference video')
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })

  it('元件離頁 -> 中止既有 run 輪詢，不清除或重送任務', async () => {
    let resolvePollingStarted: (() => void) | null = null
    const pollingStarted = new Promise<void>((resolve) => {
      resolvePollingStarted = resolve
    })
    let observedSignal: AbortSignal | undefined
    mocks.waitForTaskResult.mockImplementation((
      _runId: string,
      options: { signal?: AbortSignal },
    ) => new Promise((_resolve, reject) => {
      observedSignal = options.signal
      options.signal?.addEventListener('abort', () => {
        const error = new Error('Task polling aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
      resolvePollingStarted?.()
    }))
    const stageRef = { current: createStage() }
    const { result, unmount } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))
    act(() => {
      result.current.selectCharacterImage(new File(['character'], 'character.png', { type: 'image/png' }))
      result.current.setCharacterDescription('寫實電影角色')
      result.current.setSceneDescription('雨夜街道持續有車流')
    })
    await act(async () => {
      await result.current.generateDepthGuide()
    })
    act(() => result.current.buildPrompt())

    let pending: Promise<unknown> | null = null
    act(() => {
      pending = result.current.generate()
    })
    await pollingStarted
    expect(observedSignal?.aborted).toBe(false)

    unmount()
    await expect(pending).resolves.toBeNull()

    expect(observedSignal?.aborted).toBe(true)
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })

  it('resetResult -> 清除已提交 run id，允許使用者明確開始新任務', async () => {
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))
    act(() => {
      result.current.selectCharacterImage(new File(['character'], 'character.png', { type: 'image/png' }))
      result.current.setCharacterDescription('寫實電影角色')
      result.current.setSceneDescription('雨夜街道持續有車流')
    })
    await act(async () => {
      await result.current.generateDepthGuide()
    })
    act(() => result.current.buildPrompt())
    await act(async () => {
      await result.current.generate()
    })
    expect(result.current.submittedRunId).toBe('run-depth-1')

    act(() => result.current.resetResult())

    expect(result.current.submittedRunId).toBeNull()
    expect(result.current.result).toBeNull()
    expect(result.current.generationStatus).toBe('idle')
  })

  it('建立 Prompt 後修改場景描述 -> 阻擋上傳與付費提交', async () => {
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))
    act(() => {
      result.current.selectCharacterImage(new File(['character'], 'character.png', { type: 'image/png' }))
      result.current.setCharacterDescription('寫實電影角色')
      result.current.setSceneDescription('日間街道')
    })
    await act(async () => {
      await result.current.generateDepthGuide()
    })
    act(() => result.current.buildPrompt())
    act(() => result.current.setSceneDescription('夜間街道'))
    expect(result.current.promptIsStale).toBe(true)

    await act(async () => {
      await result.current.generate()
    })

    expect(result.current.error).toBe('設定或參考素材已變更，請重新建立 Prompt')
    expect(mocks.upload).toHaveBeenCalledTimes(0)
    expect(mocks.submit).toHaveBeenCalledTimes(0)
  })

  it('取消本機深度輸出 -> 回到 idle 且不顯示失敗', async () => {
    let rejectExport: ((reason: Error) => void) | null = null
    const exportDepthGuideVideo = vi.fn(
      (_options: { onProgress: (progress: DepthGuideProgress) => void }) =>
        new Promise<DepthGuideRecordingResult>((_resolve, reject) => {
          rejectExport = reject
        }),
    )
    const stage = createStage(exportDepthGuideVideo)
    stage.cancelDepthGuideVideo = vi.fn(() => {
      rejectExport?.(new DepthGuideRecordingCancelledError())
    })
    const stageRef = { current: stage }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))

    let pending: Promise<void> | null = null
    act(() => {
      pending = result.current.generateDepthGuide()
    })
    expect(result.current.depthGuideStatus).toBe('generating')
    act(() => result.current.cancelDepthGuide())
    await act(async () => {
      await pending
    })

    expect(stage.cancelDepthGuideVideo).toHaveBeenCalledTimes(1)
    expect(result.current.depthGuideStatus).toBe('idle')
    expect(result.current.error).toBeNull()
  })

  it('Standard 未啟用但 Fast 已啟用 -> 不自動切換模型，要求使用者明確選擇', async () => {
    mocks.videoModels.splice(0, mocks.videoModels.length,
      {
        value: 'atlascloud::seedance-2.0-fast-r2v',
        label: 'Seedance 2.0 Fast R2V',
      },
      {
        value: 'other-provider::unapproved-r2v',
        label: '不允許的模型',
      })
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))

    await act(async () => undefined)

    expect(result.current.modelKey).toBe('atlascloud::seedance-2.0-r2v')
    expect(result.current.resolution).toBe('720p')
    expect(result.current.enabledModels).toEqual([
      {
        value: 'atlascloud::seedance-2.0-fast-r2v',
        label: 'Seedance 2.0 Fast R2V',
      },
    ])

    act(() => result.current.setModelKey('atlascloud::seedance-2.0-fast-r2v'))
    expect(result.current.modelKey).toBe('atlascloud::seedance-2.0-fast-r2v')
  })

  it('費用未知 -> canGenerate 為 false 且不送出上傳', async () => {
    mocks.costEstimate = { amountUsd: null, unit: 'capability' }
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))
    act(() => {
      result.current.selectCharacterImage(new File(['character'], 'character.png', { type: 'image/png' }))
      result.current.setCharacterDescription('寫實電影角色')
      result.current.setSceneDescription('有連續車流的雨夜街道')
    })
    await act(async () => {
      await result.current.generateDepthGuide()
    })
    act(() => result.current.buildPrompt())

    expect(result.current.validationError).toBe('目前無法取得本次生成費用，已停止送出')
    expect(result.current.canGenerate).toBe(false)
    await act(async () => {
      await result.current.generate()
    })
    expect(mocks.upload).toHaveBeenCalledTimes(0)
    expect(mocks.submit).toHaveBeenCalledTimes(0)
  })

  it('上傳後端不接受的圖片格式 -> 立即顯示錯誤且不建立黑色預覽', () => {
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))

    act(() => {
      result.current.selectCharacterImage(
        new File(['<svg/>'], 'character.svg', { type: 'image/svg+xml' }),
      )
    })

    expect(result.current.characterImage).toBeNull()
    expect(result.current.error).toBe('參考圖片只支援 JPG、PNG 或 WebP')
    expect(mocks.createObjectUrl).not.toHaveBeenCalled()
  })

  it('圖片預覽解碼失敗 -> 清除破損資產並顯示可操作錯誤', () => {
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))

    act(() => {
      result.current.selectCharacterImage(
        new File(['not-an-image'], 'character.png', { type: 'image/png' }),
      )
    })
    expect(result.current.characterImage).not.toBeNull()

    act(() => result.current.rejectCharacterImage())

    expect(result.current.characterImage).toBeNull()
    expect(result.current.error).toBe('角色圖片無法解碼，請改用有效的 JPG、PNG 或 WebP')
    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith('blob:character.png')
  })
})
