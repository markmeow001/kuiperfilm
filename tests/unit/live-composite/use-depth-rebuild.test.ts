// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DepthGuideRecordingCancelledError,
  type DepthGuideProgress,
  type DepthGuideRecordingResult,
} from '@/app/[locale]/live-composite/lib/depth-guide-recorder'
import {
  useDepthRebuild as useDepthRebuildBase,
  type DepthGuideStageHandle,
  type UseDepthRebuildOptions,
} from '@/app/[locale]/live-composite/useDepthRebuild'
import { depthRebuildGenerationStorageKey } from '@/app/[locale]/live-composite/lib/depth-rebuild-generation-storage'

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

function useDepthRebuild(options: Omit<UseDepthRebuildOptions, 'userId'>) {
  return useDepthRebuildBase({
    userId: 'user-1',
    ...options,
  })
}

function makeSessionStorageWritesFail(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
  const storage = window.sessionStorage
  const unavailableStorage = new Proxy(storage, {
    get(target, property) {
      if (property === 'setItem') {
        return () => {
          throw new DOMException('storage disabled')
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: unavailableStorage,
  })
  return () => {
    if (descriptor) Object.defineProperty(window, 'sessionStorage', descriptor)
  }
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
    sessionStorage.clear()
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.addSceneImages([
        new File(['scene'], 'scene.jpg', { type: 'image/jpeg' }),
      ])
      result.current.setCharacterSourceBinding('character-1', '原片主要女演員')
      result.current.setCharacterDescription('character-1', '寫實民國女演員，短髮，灰色旗袍')
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
    expect(result.current.prompt).toContain('image 1 = identity, face, hair')
    expect(result.current.prompt).toContain('image 2 = new environment reference')
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
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.addSceneImages([
        new File(['scene'], 'scene.jpg', { type: 'image/jpeg' }),
      ])
      result.current.setCharacterSourceBinding('character-1', '原片主要女演員')
      result.current.setCharacterDescription('character-1', '寫實民國女演員，短髮，灰色旗袍')
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
      referenceImageNames: ['角色：新角色 1', '場景參考 1'],
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
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.setCharacterSourceBinding('character-1', '原片主要人物')
      result.current.setCharacterDescription('character-1', '寫實電影角色')
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
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.setCharacterSourceBinding('character-1', '原片主要人物')
      result.current.setCharacterDescription('character-1', '寫實電影角色')
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
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.setCharacterSourceBinding('character-1', '原片主要人物')
      result.current.setCharacterDescription('character-1', '寫實電影角色')
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

  it('付費任務送出後重新掛載 -> 從 sessionStorage 恢復同一 run，不重複上傳或提交', async () => {
    let notifyPollingStarted: (() => void) | null = null
    const pollingStarted = new Promise<void>((resolve) => {
      notifyPollingStarted = resolve
    })
    mocks.waitForTaskResult.mockImplementationOnce((
      _runId: string,
      options: { signal?: AbortSignal },
    ) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('Task polling aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
      notifyPollingStarted?.()
    }))

    const first = renderHook(() => useDepthRebuild({
      stageRef: { current: createStage() },
      metadata,
      videoHasAudio: false,
    }))
    act(() => {
      first.result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      first.result.current.setCharacterSourceBinding('character-1', '原片主要人物')
      first.result.current.setCharacterDescription('character-1', '寫實電影角色')
      first.result.current.setSceneDescription('雨夜街道持續有車流')
    })
    await act(async () => {
      await first.result.current.generateDepthGuide()
    })
    act(() => first.result.current.buildPrompt())

    let firstGeneration: Promise<unknown> | null = null
    act(() => {
      firstGeneration = first.result.current.generate()
    })
    await pollingStarted
    first.unmount()
    await expect(firstGeneration).resolves.toBeNull()

    expect(sessionStorage.length).toBe(1)
    expect(Array.from({ length: sessionStorage.length }, (_, index) => (
      sessionStorage.getItem(sessionStorage.key(index) ?? '')
    )).join('')).toContain('"runId":"run-depth-1"')
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.submit).toHaveBeenCalledTimes(1)

    mocks.requestJsonWithError.mockResolvedValueOnce({
      run: {
        id: 'run-depth-1',
        status: 'succeeded',
        resultUrls: ['https://media.example/resumed-after-reload.mp4'],
      },
    })
    const second = renderHook(() => useDepthRebuild({
      stageRef: { current: createStage() },
      metadata,
      videoHasAudio: false,
    }))

    expect(second.result.current.submittedRunId).toBe('run-depth-1')
    expect(second.result.current.canResume).toBe(true)
    let recovered = null
    await act(async () => {
      recovered = await second.result.current.generate()
    })

    expect(recovered).toEqual({
      runId: 'run-depth-1',
      url: 'https://media.example/resumed-after-reload.mp4',
    })
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(mocks.requestJsonWithError.mock.calls.at(-1)?.[0]).toBe(
      '/api/playground/runs/run-depth-1',
    )
  })

  it('瀏覽器無法保存付費請求識別碼 -> 在上傳與提交前明確停止', async () => {
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))
    act(() => {
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.setCharacterSourceBinding('character-1', '原片主要人物')
      result.current.setCharacterDescription('character-1', '寫實電影角色')
      result.current.setSceneDescription('雨夜街道持續有車流')
    })
    await act(async () => {
      await result.current.generateDepthGuide()
    })
    act(() => result.current.buildPrompt())
    const restoreStorage = makeSessionStorageWritesFail()
    try {
      await act(async () => {
        await result.current.generate()
      })
    } finally {
      restoreStorage()
    }

    expect(result.current.error).toBe(
      '瀏覽器無法安全保存這次付費任務，已停止送出；請確認未停用工作階段儲存空間後重試',
    )
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('sessionStorage 中的舊 run 已不存在 -> 顯示可清除的終端失敗，不會永久卡在恢復狀態', async () => {
    const scope = 'user:user-1:locale:zh:source:performance.mp4:12:1920:1080'
    const storageKey = depthRebuildGenerationStorageKey(scope)
    sessionStorage.setItem(storageKey, JSON.stringify({
      requestKey: 'request-for-missing-run',
      runId: 'missing-run',
    }))
    mocks.requestJsonWithError.mockResolvedValueOnce({ run: null })
    const { result } = renderHook(() => useDepthRebuild({
      stageRef: { current: createStage() },
      metadata,
      videoHasAudio: false,
    }))

    expect(result.current.canResume).toBe(true)
    await act(async () => {
      await result.current.generate()
    })

    expect(result.current.error).toBe(
      '找不到已提交的深度重建任務：missing-run；可清除這筆舊紀錄後重新建立',
    )
    expect(result.current.canResume).toBe(false)
    expect(result.current.submittedRunId).toBe('missing-run')
    act(() => result.current.resetResult())
    expect(sessionStorage.getItem(storageKey)).toBeNull()
    expect(result.current.submittedRunId).toBeNull()
  })

  it('resetResult -> 清除已提交 run id，允許使用者明確開始新任務', async () => {
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))
    act(() => {
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.setCharacterSourceBinding('character-1', '原片主要人物')
      result.current.setCharacterDescription('character-1', '寫實電影角色')
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
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.setCharacterSourceBinding('character-1', '原片主要人物')
      result.current.setCharacterDescription('character-1', '寫實電影角色')
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
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.setCharacterSourceBinding('character-1', '原片主要人物')
      result.current.setCharacterDescription('character-1', '寫實電影角色')
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

  it('人物與場景共用 9 張配額 -> 超額整批拒絕，不會只加入部分圖片', () => {
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))

    act(() => {
      result.current.selectCharacterImage(
        'character-1',
        new File(['character-1'], 'character-1.png', { type: 'image/png' }),
      )
      result.current.addCharacter()
      result.current.selectCharacterImage(
        'character-2',
        new File(['character-2'], 'character-2.png', { type: 'image/png' }),
      )
      result.current.addSceneImages(
        Array.from({ length: 7 }, (_, index) => (
          new File([`scene-${index + 1}`], `scene-${index + 1}.jpg`, { type: 'image/jpeg' })
        )),
      )
    })

    expect(result.current.referenceImageCount).toBe(9)
    expect(result.current.characters.filter((character) => character.image).length).toBe(2)
    expect(result.current.sceneReferences).toHaveLength(7)

    act(() => {
      result.current.addSceneImages([
        new File(['overflow-1'], 'overflow-1.jpg', { type: 'image/jpeg' }),
        new File(['overflow-2'], 'overflow-2.jpg', { type: 'image/jpeg' }),
      ])
    })

    expect(result.current.referenceImageCount).toBe(9)
    expect(result.current.sceneReferences).toHaveLength(7)
    expect(result.current.error).toBe('Seedance 的 9 個參考位置已分配完畢')
    expect(mocks.createObjectUrl).toHaveBeenCalledTimes(9)
  })

  it('空白必填角色先保留一格 -> 場景最多先放八張，之後仍可補上角色圖', () => {
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))
    const nineScenes = Array.from({ length: 9 }, (_, index) => (
      new File([`scene-${index + 1}`], `scene-${index + 1}.jpg`, { type: 'image/jpeg' })
    ))

    act(() => result.current.addSceneImages(nineScenes))

    expect(result.current.sceneReferences).toHaveLength(0)
    expect(result.current.error).toContain('已替角色保留位置，目前還能加入 8 張場景圖')

    act(() => {
      result.current.addSceneImages(nineScenes.slice(0, 8))
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
    })

    expect(result.current.sceneReferences).toHaveLength(8)
    expect(result.current.characters[0]?.image?.file.name).toBe('character.png')
    expect(result.current.referenceImageCount).toBe(9)
  })

  it('仍有角色卡缺圖 -> 即使直接呼叫也不建立錯位 Prompt', () => {
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))

    act(() => {
      result.current.selectCharacterImage(
        'character-1',
        new File(['character'], 'character.png', { type: 'image/png' }),
      )
      result.current.addCharacter()
      result.current.setSceneDescription('雨夜街道持續有車流')
    })
    act(() => {
      result.current.buildPrompt()
    })

    expect(result.current.prompt).toBe('')
    expect(result.current.error).toBe('請先上傳角色 2 的參考圖片，再建立 Prompt')
  })

  it('角色 AI 補全 -> 由使用者按下後建立文字任務並套回指定角色', async () => {
    mocks.requestJsonWithError.mockResolvedValueOnce({ taskId: 'task-character-copy' })
    mocks.waitForTaskResult.mockResolvedValueOnce({
      text: '寫實電影角色，俐落黑色短髮，深色長風衣，臉部與服裝細節跨幀穩定。',
    })
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
      locale: 'zh',
    }))

    act(() => {
      result.current.setCharacterBrief('character-1', '民國女記者，短髮，黑色大衣')
    })
    await act(async () => {
      await result.current.assistCharacterDescription('character-1')
    })

    const submitCall = mocks.requestJsonWithError.mock.calls[0]
    expect(submitCall?.[0]).toBe('/api/canvas/text')
    expect(submitCall?.[2]).toBe('AI 描述補全送出失敗')
    const submitOptions = submitCall?.[1] as RequestInit
    expect(submitOptions).toEqual(expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal),
    }))
    expect(JSON.parse(String(submitOptions.body))).toMatchObject({
      text: '民國女記者，短髮，黑色大衣',
      mode: 'r2v_character',
      locale: 'zh',
      requestKey: expect.any(String),
    })
    expect(mocks.waitForTaskResult).toHaveBeenCalledWith(
      'task-character-copy',
      expect.objectContaining({
        intervalMs: 1200,
        timeoutMs: 0,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(result.current.characters[0]?.description).toContain('俐落黑色短髮')
    expect(result.current.descriptionAssistTarget).toBeNull()
  })

  it('AI 補全送出後離頁再回來 -> 接續同一任務，不重複建立付費任務', async () => {
    mocks.requestJsonWithError.mockResolvedValueOnce({ taskId: 'task-resume-copy' })
    let notifyPollingStarted: (() => void) | null = null
    const pollingStarted = new Promise<void>((resolve) => {
      notifyPollingStarted = resolve
    })
    mocks.waitForTaskResult.mockImplementationOnce((
      _taskId: string,
      options: { signal?: AbortSignal },
    ) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('Task polling aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
      notifyPollingStarted?.()
    }))

    const first = renderHook(() => useDepthRebuild({
      stageRef: { current: createStage() },
      metadata,
      videoHasAudio: false,
      locale: 'zh',
    }))
    act(() => {
      first.result.current.setCharacterBrief('character-1', '民國女記者，短髮，黑色大衣')
    })
    let firstAssist: Promise<void> | null = null
    await act(async () => {
      firstAssist = first.result.current.assistCharacterDescription('character-1')
      await pollingStarted
    })
    first.unmount()
    await act(async () => {
      await firstAssist
    })

    expect(sessionStorage.length).toBe(1)
    expect(Array.from({ length: sessionStorage.length }, (_, index) => (
      sessionStorage.getItem(sessionStorage.key(index) ?? '')
    )).join('')).toContain('task-resume-copy')

    mocks.requestJsonWithError.mockClear()
    mocks.waitForTaskResult.mockResolvedValueOnce({
      text: '接續完成的民國女記者角色描述',
    })
    const second = renderHook(() => useDepthRebuild({
      stageRef: { current: createStage() },
      metadata,
      videoHasAudio: false,
      locale: 'zh',
    }))
    act(() => {
      second.result.current.setCharacterBrief('character-1', '民國女記者，短髮，黑色大衣')
    })
    await act(async () => {
      await second.result.current.assistCharacterDescription('character-1')
    })

    expect(mocks.requestJsonWithError).not.toHaveBeenCalled()
    expect(mocks.waitForTaskResult).toHaveBeenLastCalledWith(
      'task-resume-copy',
      expect.objectContaining({ timeoutMs: 0 }),
    )
    expect(second.result.current.characters[0]?.description).toContain('接續完成')
    expect(sessionStorage.length).toBe(0)
  })

  it('瀏覽器無法保存 AI 補全 requestKey -> 不建立付費文字任務', async () => {
    const { result } = renderHook(() => useDepthRebuild({
      stageRef: { current: createStage() },
      metadata,
      videoHasAudio: false,
      locale: 'zh',
    }))
    act(() => {
      result.current.setCharacterBrief('character-1', '民國女記者，短髮，黑色大衣')
    })
    const restoreStorage = makeSessionStorageWritesFail()
    try {
      await act(async () => {
        await result.current.assistCharacterDescription('character-1')
      })
    } finally {
      restoreStorage()
    }

    expect(result.current.error).toBe(
      '瀏覽器無法安全保存這次 AI 任務，已停止送出；請確認未停用工作階段儲存空間後重試',
    )
    expect(mocks.requestJsonWithError).not.toHaveBeenCalled()
    expect(mocks.waitForTaskResult).not.toHaveBeenCalled()
  })

  it('已保存的 AI 補全 taskId 回傳 404 -> 清除舊紀錄，允許下一次重新建立', async () => {
    const scope = 'user:user-1:locale:zh:source:performance.mp4:12:1920:1080'
    const storageKey = `kuiper:depth-description-assist:${encodeURIComponent(scope)}:${encodeURIComponent('character:character-1')}`
    sessionStorage.setItem(storageKey, JSON.stringify({
      kind: 'character',
      brief: '民國女記者',
      requestKey: 'stale-request',
      taskId: 'missing-task',
    }))
    mocks.waitForTaskResult.mockRejectedValueOnce(new Error('找不到任務'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }))
    const { result } = renderHook(() => useDepthRebuild({
      stageRef: { current: createStage() },
      metadata,
      videoHasAudio: false,
      locale: 'zh',
    }))
    act(() => {
      result.current.setCharacterBrief('character-1', '民國女記者')
    })

    await act(async () => {
      await result.current.assistCharacterDescription('character-1')
    })

    expect(result.current.error).toBe('找不到任務')
    expect(sessionStorage.getItem(storageKey)).toBeNull()
    expect(mocks.requestJsonWithError).not.toHaveBeenCalled()
  })

  it('AI 補全任務已完成但結果暫時無法解析 -> 保留同一 taskId，重試時不重複建立付費任務', async () => {
    mocks.requestJsonWithError.mockResolvedValueOnce({ taskId: 'task-completed-copy' })
    mocks.waitForTaskResult
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        text: '重取成功的寫實民國女記者角色描述',
      })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        task: { status: 'completed' },
      }),
    }))
    const scope = 'user:user-1:locale:zh:source:performance.mp4:12:1920:1080'
    const storageKey = `kuiper:depth-description-assist:${encodeURIComponent(scope)}:${encodeURIComponent('character:character-1')}`
    const { result } = renderHook(() => useDepthRebuild({
      stageRef: { current: createStage() },
      metadata,
      videoHasAudio: false,
      locale: 'zh',
    }))
    act(() => {
      result.current.setCharacterBrief('character-1', '民國女記者')
    })

    await act(async () => {
      await result.current.assistCharacterDescription('character-1')
    })

    expect(result.current.error).toBe('AI 沒有回傳可用描述')
    expect(sessionStorage.getItem(storageKey)).toContain('task-completed-copy')

    mocks.requestJsonWithError.mockClear()
    await act(async () => {
      await result.current.assistCharacterDescription('character-1')
    })

    expect(mocks.requestJsonWithError).not.toHaveBeenCalled()
    expect(mocks.waitForTaskResult).toHaveBeenLastCalledWith(
      'task-completed-copy',
      expect.objectContaining({ timeoutMs: 0 }),
    )
    expect(result.current.characters[0]?.description).toContain('重取成功')
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it.each(['queued', 'processing'] as const)(
    'AI 補全結果讀取失敗且任務仍為 %s -> 保留 requestKey 與 taskId 供下次接續',
    async (status) => {
      mocks.requestJsonWithError.mockResolvedValueOnce({ taskId: `task-${status}-copy` })
      mocks.waitForTaskResult.mockRejectedValueOnce(new Error('結果讀取暫時失敗'))
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          task: { status },
        }),
      }))
      const scope = 'user:user-1:locale:zh:source:performance.mp4:12:1920:1080'
      const storageKey = `kuiper:depth-description-assist:${encodeURIComponent(scope)}:${encodeURIComponent('character:character-1')}`
      const { result } = renderHook(() => useDepthRebuild({
        stageRef: { current: createStage() },
        metadata,
        videoHasAudio: false,
        locale: 'zh',
      }))
      act(() => {
        result.current.setCharacterBrief('character-1', '民國女記者')
      })

      await act(async () => {
        await result.current.assistCharacterDescription('character-1')
      })

      expect(result.current.error).toBe('結果讀取暫時失敗')
      expect(sessionStorage.getItem(storageKey)).toContain(`task-${status}-copy`)
    },
  )

  it('AI 補全結果讀取失敗且任務已 failed -> 清除舊紀錄，允許重新建立', async () => {
    mocks.requestJsonWithError.mockResolvedValueOnce({ taskId: 'task-failed-copy' })
    mocks.waitForTaskResult.mockRejectedValueOnce(new Error('文字模型執行失敗'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        task: { status: 'failed' },
      }),
    }))
    const scope = 'user:user-1:locale:zh:source:performance.mp4:12:1920:1080'
    const storageKey = `kuiper:depth-description-assist:${encodeURIComponent(scope)}:${encodeURIComponent('character:character-1')}`
    const { result } = renderHook(() => useDepthRebuild({
      stageRef: { current: createStage() },
      metadata,
      videoHasAudio: false,
      locale: 'zh',
    }))
    act(() => {
      result.current.setCharacterBrief('character-1', '民國女記者')
    })

    await act(async () => {
      await result.current.assistCharacterDescription('character-1')
    })

    expect(result.current.error).toBe('文字模型執行失敗')
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  })

  it('場景 AI 補全失敗 -> 保留使用者原本的完整描述', async () => {
    mocks.requestJsonWithError.mockResolvedValueOnce({ taskId: 'task-scene-copy' })
    mocks.waitForTaskResult.mockRejectedValueOnce(new Error('文字模型暫時不可用'))
    const stageRef = { current: createStage() }
    const { result } = renderHook(() => useDepthRebuild({
      stageRef,
      metadata,
      videoHasAudio: false,
    }))

    act(() => {
      result.current.setSceneBrief('雨夜上海街口')
      result.current.setSceneDescription('保留這段既有場景描述')
    })
    await act(async () => {
      await result.current.assistSceneDescription()
    })

    expect(result.current.sceneDescription).toBe('保留這段既有場景描述')
    expect(result.current.error).toBe('文字模型暫時不可用')
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
        'character-1',
        new File(['<svg/>'], 'character.svg', { type: 'image/svg+xml' }),
      )
    })

    expect(result.current.characters[0]?.image).toBeNull()
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
        'character-1',
        new File(['not-an-image'], 'character.png', { type: 'image/png' }),
      )
    })
    expect(result.current.characters[0]?.image).not.toBeNull()

    act(() => result.current.rejectCharacterImage('character-1'))

    expect(result.current.characters[0]?.image).toBeNull()
    expect(result.current.error).toBe('角色圖片無法解碼，請改用有效的 JPG、PNG 或 WebP')
    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith('blob:character.png')
  })
})
