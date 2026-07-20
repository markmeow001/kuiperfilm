import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRvmSession,
  negotiateRvmSession,
  ORT_WASM_ASSET_PATH,
  releaseRvmSession,
  RVM_MODEL_PATH,
  rvmEpLabel,
  scanPersonMasksRvm,
  segmentPersonFrameRvm,
  type RvmExecutionProvider,
  type RvmOrtModule,
  type RvmOrtSession,
} from '@/app/[locale]/live-composite/lib/rvm-engine'
import type { MaskRaster } from '@/app/[locale]/live-composite/live-composite-types'

// createRvmSession dynamic-imports onnxruntime-web; the mock guarantees no
// real WASM/WebGPU runtime is ever loaded in CI.
const mockedCreate = vi.fn()
vi.mock('onnxruntime-web', () => ({
  env: { wasm: {} },
  Tensor: class {
    constructor(
      public type: string,
      public data: Float32Array,
      public dims: readonly number[],
    ) {}
  },
  InferenceSession: {
    create: (path: string, options: { executionProviders: RvmExecutionProvider[] }) => mockedCreate(path, options),
  },
}))

function fakeSession(): RvmOrtSession {
  // Warmup 推理成功：回傳可 dispose 的空輸出集合。
  return {
    run: vi.fn().mockResolvedValue({ pha: { data: new Float32Array(1), dims: [1, 1, 1, 1], dispose: vi.fn() } }),
    release: vi.fn().mockResolvedValue(undefined),
  }
}

function fakeWarmupFailingSession(message: string): RvmOrtSession {
  return {
    run: vi.fn().mockRejectedValue(new Error(message)),
    release: vi.fn().mockResolvedValue(undefined),
  }
}

function fakeOrt(create: typeof mockedCreate): RvmOrtModule {
  return {
    env: { wasm: {} },
    Tensor: class {
      constructor(
        public type: 'float32',
        public data: Float32Array,
        public dims: readonly number[],
      ) {}
    } as unknown as RvmOrtModule['Tensor'],
    InferenceSession: { create: create as unknown as RvmOrtModule['InferenceSession']['create'] },
  }
}

describe('negotiateRvmSession（EP 協商）', () => {
  it('WebGPU 可用 -> 選 WebGPU，並鎖定單執行緒 WASM 設定（不動 COOP/COEP）', async () => {
    const session = fakeSession()
    const create = vi.fn().mockResolvedValue(session)
    const ort = fakeOrt(create)

    const negotiated = await negotiateRvmSession(ort, '/models/x.onnx')

    expect(negotiated.ep).toBe('webgpu')
    expect(negotiated.session).toBe(session)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith('/models/x.onnx', { executionProviders: ['webgpu'] })
    expect(ort.env.wasm.numThreads).toBe(1)
    expect(ort.env.wasm.wasmPaths).toBe(ORT_WASM_ASSET_PATH)
  })

  it('WebGPU 失敗 -> 回退單執行緒 WASM，標籤標示較慢', async () => {
    const session = fakeSession()
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('no webgpu adapter'))
      .mockResolvedValueOnce(session)

    const negotiated = await negotiateRvmSession(fakeOrt(create), '/models/x.onnx')

    expect(negotiated.ep).toBe('wasm')
    expect(create).toHaveBeenNthCalledWith(2, '/models/x.onnx', { executionProviders: ['wasm'] })
    expect(rvmEpLabel(negotiated.ep)).toBe('RVM · WASM（較慢）')
  })

  it('兩個 EP 都失敗 -> 明確丟錯（帶出兩個原因），不得靜默改用 Selfie Segmenter', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('no webgpu adapter'))
      .mockRejectedValueOnce(new Error('wasm fetch failed'))

    await expect(negotiateRvmSession(fakeOrt(create), '/models/x.onnx')).rejects.toThrow(
      /RVM 引擎無法初始化.*no webgpu adapter.*wasm fetch failed/,
    )
  })

  it('EP 標籤對應 UI 顯示字串', () => {
    expect(rvmEpLabel('webgpu')).toBe('RVM · WebGPU')
    expect(rvmEpLabel('wasm')).toBe('RVM · WASM（較慢）')
  })

  it('session 建立成功但 warmup 推理失敗 -> 該 EP 視為失敗並釋放，回退下一個 EP（2026-07-20 AveragePool ceil 實戰）', async () => {
    const broken = fakeWarmupFailingSession('using ceil() in shape computation is not yet supported for AveragePool')
    const good = fakeSession()
    const create = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(good)

    const negotiated = await negotiateRvmSession(fakeOrt(create), '/models/x.onnx')

    expect(negotiated.ep).toBe('wasm')
    expect(negotiated.session).toBe(good)
    expect(broken.release).toHaveBeenCalledTimes(1)
  })

  it('兩個 EP 都在 warmup 失敗 -> 明確丟錯帶出兩個原因', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(fakeWarmupFailingSession('ceil not supported'))
      .mockResolvedValueOnce(fakeWarmupFailingSession('wasm op missing'))

    await expect(negotiateRvmSession(fakeOrt(create), '/models/x.onnx')).rejects.toThrow(
      /RVM 引擎無法初始化.*ceil not supported.*wasm op missing/,
    )
  })
})

describe('createRvmSession（快取與釋放）', () => {
  beforeEach(() => {
    mockedCreate.mockReset()
  })

  afterEach(async () => {
    await releaseRvmSession()
  })

  it('第一次建立後快取，第二次不再載入模型', async () => {
    const session = fakeSession()
    mockedCreate.mockResolvedValue(session)

    const first = await createRvmSession()
    const second = await createRvmSession()

    expect(first).toBe(second)
    expect(first.epLabel).toBe('RVM · WebGPU')
    expect(mockedCreate).toHaveBeenCalledTimes(1)
    expect(mockedCreate).toHaveBeenCalledWith(RVM_MODEL_PATH, { executionProviders: ['webgpu'] })
  })

  it('releaseRvmSession -> 釋放 session 並允許重新初始化', async () => {
    const session = fakeSession()
    mockedCreate.mockResolvedValue(session)

    await createRvmSession()
    await releaseRvmSession()

    expect(session.release).toHaveBeenCalledTimes(1)

    await createRvmSession()
    expect(mockedCreate).toHaveBeenCalledTimes(2)
  })

  it('初始化失敗 -> 快取清空，下一次重試會重新初始化', async () => {
    mockedCreate.mockRejectedValue(new Error('boom'))
    await expect(createRvmSession()).rejects.toThrow('RVM 引擎無法初始化')

    const session = fakeSession()
    mockedCreate.mockReset()
    mockedCreate.mockResolvedValue(session)
    const engine = await createRvmSession()
    expect(engine.ep).toBe('webgpu')
  })
})

describe('segmentPersonFrameRvm（soft alpha 直通合成）', () => {
  beforeEach(() => {
    mockedCreate.mockReset()
    const fakeContext = {
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    }
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext }),
    })
  })

  afterEach(async () => {
    await releaseRvmSession()
    vi.unstubAllGlobals()
  })

  it('RVM matte 保留原生柔邊：門檻是 alpha floor，不再二值化成 0/255', async () => {
    const run = vi.fn()
      // 第一次呼叫是 EP warmup 推理。
      .mockResolvedValueOnce({})
      // 第二次是真正的影格推理：pha 帶柔邊信心值。
      .mockResolvedValueOnce({
        pha: { data: Float32Array.of(1, 0.6, 0.4, 0.2), dims: [1, 1, 1, 4], dispose: vi.fn() },
        r1o: {}, r2o: {}, r3o: {}, r4o: {},
      })
    mockedCreate.mockResolvedValue({ run, release: vi.fn().mockResolvedValue(undefined) })
    const video = { videoWidth: 4, videoHeight: 1 } as unknown as HTMLVideoElement

    const { mask } = await segmentPersonFrameRvm(video, 0.5, 0)

    expect({ width: mask.width, height: mask.height }).toEqual({ width: 4, height: 1 })
    // 0.6 -> 153（柔邊保留）；0.4 / 0.2 低於門檻 -> 0（floor 裁掉）。
    expect([...mask.alpha]).toEqual([255, 153, 0, 0])
  })
})

describe('scanPersonMasksRvm（深度淨化 gate hook）', () => {
  beforeEach(() => {
    mockedCreate.mockReset()
    const fakeContext = {
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    }
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext }),
    })
  })

  afterEach(async () => {
    await releaseRvmSession()
    vi.unstubAllGlobals()
  })

  function fakeScanVideo(): HTMLVideoElement {
    return {
      videoWidth: 2,
      videoHeight: 1,
      readyState: 2,
      currentTime: 0,
      pause: vi.fn(),
      requestVideoFrameCallback: (callback: () => void) => {
        globalThis.setTimeout(callback, 0)
        return 1
      },
      cancelVideoFrameCallback: vi.fn(),
    } as unknown as HTMLVideoElement
  }

  function fakeScanSession() {
    const states = { r1o: {}, r2o: {}, r3o: {}, r4o: {} }
    const run = vi.fn()
      // 第一次呼叫是 EP warmup 推理。
      .mockResolvedValueOnce({})
      .mockResolvedValue({
        pha: { data: Float32Array.of(1, 0.9), dims: [1, 1, 1, 2], dispose: vi.fn() },
        ...states,
      })
    mockedCreate.mockResolvedValue({ run, release: vi.fn().mockResolvedValue(undefined) })
    return run
  }

  it('gateMask 只在 keyframe commit 時呼叫（不逐掃描幀跑），結果標 depthOutcome', async () => {
    const run = fakeScanSession()
    const gatedMask: MaskRaster = { width: 2, height: 1, alpha: Uint8ClampedArray.of(255, 0) }
    const gateMask = vi.fn().mockResolvedValue({ mask: gatedMask, outcome: 'applied' as const })

    // 0.2 秒 @10fps → 掃描 3 幀（0 / 0.1 / 0.2），只 commit 2 個關鍵影格。
    const frames = await scanPersonMasksRvm(fakeScanVideo(), {
      duration: 0.2,
      fps: 10,
      commitTimes: [0, 0.2],
      threshold: 0.5,
      edgeSoftness: 0,
      signal: new AbortController().signal,
      shouldContinue: () => true,
      onProgress: vi.fn(),
      gateMask,
    })

    // warmup + 3 幀推理。
    expect(run).toHaveBeenCalledTimes(4)
    expect(gateMask).toHaveBeenCalledTimes(2)
    expect(frames).toHaveLength(2)
    for (const frame of frames) {
      expect(frame.mask).toBe(gatedMask)
      expect(frame.depthOutcome).toBe('applied')
    }
  })

  it('未提供 gateMask → depthOutcome = off，遮罩為 RVM 原生輸出', async () => {
    fakeScanSession()

    const frames = await scanPersonMasksRvm(fakeScanVideo(), {
      duration: 0.1,
      fps: 10,
      commitTimes: [0.1],
      threshold: 0.5,
      edgeSoftness: 0,
      signal: new AbortController().signal,
      shouldContinue: () => true,
      onProgress: vi.fn(),
    })

    expect(frames).toHaveLength(1)
    expect(frames[0].depthOutcome).toBe('off')
    // float32(0.9) ≈ 0.8999999762 → ×255 → round = 229。
    expect([...frames[0].mask.alpha]).toEqual([255, 229])
  })
})
