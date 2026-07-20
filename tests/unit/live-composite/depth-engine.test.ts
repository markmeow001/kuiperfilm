import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanMaskWithDepth,
  computeDepthInputSize,
  createDepthSession,
  DEPTH_INPUT_LONG_SIDE,
  DEPTH_INPUT_MULTIPLE,
  DEPTH_MODEL_PATH,
  estimateDepthMap,
  negotiateDepthSession,
  normalizeInverseDepth,
  releaseDepthSession,
  rgbaToImageNetTensorData,
} from '@/app/[locale]/live-composite/lib/depth-engine'
import type {
  OnnxExecutionProvider,
  OnnxModule,
  OnnxSession,
  OnnxTensor,
} from '@/app/[locale]/live-composite/lib/onnx-session'
import type { MaskRaster } from '@/app/[locale]/live-composite/live-composite-types'

// createDepthSession dynamic-imports onnxruntime-web; the mock guarantees no
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
    create: (path: string, options: { executionProviders: OnnxExecutionProvider[] }) => mockedCreate(path, options),
  },
}))

function fakeOrt(create: typeof mockedCreate): OnnxModule {
  return {
    env: { wasm: {} },
    Tensor: class {
      constructor(
        public type: 'float32',
        public data: Float32Array,
        public dims: readonly number[],
      ) {}
    } as unknown as OnnxModule['Tensor'],
    InferenceSession: { create: create as unknown as OnnxModule['InferenceSession']['create'] },
  }
}

function fakeSession(): OnnxSession {
  return {
    run: vi.fn().mockResolvedValue({}),
    release: vi.fn().mockResolvedValue(undefined),
  }
}

function stubCanvasDocument(): void {
  const fakeContext = {
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
  }
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext }),
  })
}

describe('computeDepthInputSize（/14 契約）', () => {
  it('長邊縮到 ≈518、兩邊都是 14 的倍數', () => {
    for (const [width, height] of [[1920, 1080], [1080, 1920], [1280, 720], [640, 360], [518, 518]]) {
      const size = computeDepthInputSize(width, height)
      expect(size.width % DEPTH_INPUT_MULTIPLE).toBe(0)
      expect(size.height % DEPTH_INPUT_MULTIPLE).toBe(0)
      expect(Math.max(size.width, size.height)).toBe(DEPTH_INPUT_LONG_SIDE)
    }
  })

  it('1920x1080 → 518x294（長寬比保留到最近的 /14）', () => {
    expect(computeDepthInputSize(1920, 1080)).toEqual({ width: 518, height: 294 })
  })

  it('極端窄邊仍至少 14', () => {
    const size = computeDepthInputSize(5000, 10)
    expect(size).toEqual({ width: 518, height: 14 })
  })

  it('無效尺寸 → 明確丟錯', () => {
    expect(() => computeDepthInputSize(0, 100)).toThrow('影片尺寸無效')
    expect(() => computeDepthInputSize(100, Number.NaN)).toThrow('影片尺寸無效')
  })
})

describe('rgbaToImageNetTensorData（ImageNet 正規化）', () => {
  it('黑色像素 → (0 − mean) / std；白色像素 → (1 − mean) / std', () => {
    // 2 個像素：黑、白。
    const rgba = Uint8ClampedArray.of(0, 0, 0, 255, 255, 255, 255, 255)
    const chw = rgbaToImageNetTensorData(rgba, 2, 1)
    expect(chw).toHaveLength(6)
    // R plane
    expect(chw[0]).toBeCloseTo((0 - 0.485) / 0.229, 5)
    expect(chw[1]).toBeCloseTo((1 - 0.485) / 0.229, 5)
    // G plane
    expect(chw[2]).toBeCloseTo((0 - 0.456) / 0.224, 5)
    expect(chw[3]).toBeCloseTo((1 - 0.456) / 0.224, 5)
    // B plane
    expect(chw[4]).toBeCloseTo((0 - 0.406) / 0.225, 5)
    expect(chw[5]).toBeCloseTo((1 - 0.406) / 0.225, 5)
  })

  it('像素長度不符 → 明確丟錯', () => {
    expect(() => rgbaToImageNetTensorData(new Uint8ClampedArray(7), 2, 1)).toThrow('深度輸入像素長度不符')
  })
})

describe('normalizeInverseDepth（逐幀 0-1 正規化）', () => {
  it('線性映射 min→0、max→1', () => {
    const out = normalizeInverseDepth(Float32Array.of(2, 3, 4, 6))
    expect([...out].map((value) => Number(value.toFixed(4)))).toEqual([0, 0.25, 0.5, 1])
  })

  it('完全平坦的深度圖 → 全 0.5（帶會涵蓋所有像素，gating 退化為 NO-OP）', () => {
    const out = normalizeInverseDepth(Float32Array.of(7, 7, 7))
    expect([...out]).toEqual([0.5, 0.5, 0.5])
  })

  it('NaN / 空陣列 → 明確丟錯', () => {
    expect(() => normalizeInverseDepth(Float32Array.of(1, Number.NaN))).toThrow('深度圖包含無效數值')
    expect(() => normalizeInverseDepth(new Float32Array(0))).toThrow('深度圖為空')
  })
})

describe('negotiateDepthSession（EP 協商沿用 RVM 模式）', () => {
  it('WebGPU 可用 → 選 WebGPU；warmup 輸入是 /14 倍數的方形零張量', async () => {
    const session = fakeSession()
    const create = vi.fn().mockResolvedValue(session)
    const ort = fakeOrt(create)

    const negotiated = await negotiateDepthSession(ort, '/models/depth.onnx')

    expect(negotiated.ep).toBe('webgpu')
    expect(create).toHaveBeenCalledWith('/models/depth.onnx', { executionProviders: ['webgpu'] })
    expect(ort.env.wasm.numThreads).toBe(1)
    const warmupFeeds = (session.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, OnnxTensor>
    const pixelValues = warmupFeeds.pixel_values
    expect(pixelValues.dims[0]).toBe(1)
    expect(pixelValues.dims[1]).toBe(3)
    expect(Number(pixelValues.dims[2]) % DEPTH_INPUT_MULTIPLE).toBe(0)
    expect(Number(pixelValues.dims[3]) % DEPTH_INPUT_MULTIPLE).toBe(0)
  })

  it('session 建立成功但 warmup 失敗 → 該 EP 視為失敗並釋放，回退 WASM', async () => {
    const broken: OnnxSession = {
      run: vi.fn().mockRejectedValue(new Error('op not supported on webgpu')),
      release: vi.fn().mockResolvedValue(undefined),
    }
    const good = fakeSession()
    const create = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(good)

    const negotiated = await negotiateDepthSession(fakeOrt(create), '/models/depth.onnx')

    expect(negotiated.ep).toBe('wasm')
    expect(negotiated.session).toBe(good)
    expect(broken.release).toHaveBeenCalledTimes(1)
  })

  it('兩個 EP 都失敗 → 明確丟錯帶出兩個原因（不靜默跳過深度淨化）', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('no webgpu adapter'))
      .mockRejectedValueOnce(new Error('wasm fetch failed'))

    await expect(negotiateDepthSession(fakeOrt(create), '/models/depth.onnx')).rejects.toThrow(
      /深度引擎無法初始化.*no webgpu adapter.*wasm fetch failed/,
    )
  })
})

describe('createDepthSession（快取與釋放）', () => {
  beforeEach(() => {
    mockedCreate.mockReset()
  })

  afterEach(async () => {
    await releaseDepthSession()
  })

  it('第一次建立後快取，第二次不再載入模型', async () => {
    const session = fakeSession()
    mockedCreate.mockResolvedValue(session)

    const first = await createDepthSession()
    const second = await createDepthSession()

    expect(first).toBe(second)
    expect(mockedCreate).toHaveBeenCalledTimes(1)
    expect(mockedCreate).toHaveBeenCalledWith(DEPTH_MODEL_PATH, { executionProviders: ['webgpu'] })
  })

  it('releaseDepthSession → 釋放 session 並允許重新初始化', async () => {
    const session = fakeSession()
    mockedCreate.mockResolvedValue(session)

    await createDepthSession()
    await releaseDepthSession()

    expect(session.release).toHaveBeenCalledTimes(1)
    await createDepthSession()
    expect(mockedCreate).toHaveBeenCalledTimes(2)
  })

  it('初始化失敗 → 快取清空，下一次重試會重新初始化', async () => {
    mockedCreate.mockRejectedValue(new Error('boom'))
    await expect(createDepthSession()).rejects.toThrow('深度引擎無法初始化')

    mockedCreate.mockReset()
    mockedCreate.mockResolvedValue(fakeSession())
    const engine = await createDepthSession()
    expect(engine.ep).toBe('webgpu')
  })
})

describe('estimateDepthMap / cleanMaskWithDepth', () => {
  beforeEach(() => {
    mockedCreate.mockReset()
    stubCanvasDocument()
  })

  afterEach(async () => {
    await releaseDepthSession()
    vi.unstubAllGlobals()
  })

  /** run mock：第一次呼叫是 warmup，之後回傳指定的 predicted_depth。 */
  function sessionWithDepthOutput(depthData: Float32Array, dims: readonly number[]) {
    const run = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValue({
        predicted_depth: { data: depthData, dims, dispose: vi.fn() },
      })
    mockedCreate.mockResolvedValue({ run, release: vi.fn().mockResolvedValue(undefined) })
    return run
  }

  it('推理輸入：尺寸為 /14 倍數（長邊 518）、黑幀值等於 ImageNet 正規化後的 (0−mean)/std', async () => {
    const run = sessionWithDepthOutput(Float32Array.of(1, 2, 3, 4), [1, 2, 2])
    const video = { videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement

    await estimateDepthMap(video)

    const feeds = run.mock.calls[1][0] as Record<string, OnnxTensor>
    const input = feeds.pixel_values
    expect(input.dims).toEqual([1, 3, 294, 518])
    const data = input.data as Float32Array
    expect(data).toHaveLength(3 * 294 * 518)
    // Stubbed canvas 回全零 RGBA → R plane 全部 = (0 − 0.485) / 0.229。
    expect(data[0]).toBeCloseTo((0 - 0.485) / 0.229, 5)
    expect(data[294 * 518]).toBeCloseTo((0 - 0.456) / 0.224, 5)
  })

  it('輸出逐幀正規化到 0-1（相對逆深度，越大越近）', async () => {
    sessionWithDepthOutput(Float32Array.of(2, 3, 4, 6), [1, 2, 2])
    const video = { videoWidth: 640, videoHeight: 640 } as unknown as HTMLVideoElement

    const map = await estimateDepthMap(video)

    expect({ width: map.width, height: map.height }).toEqual({ width: 2, height: 2 })
    expect([...map.depth].map((value) => Number(value.toFixed(4)))).toEqual([0, 0.25, 0.5, 1])
  })

  it('模型沒回傳 predicted_depth → 明確丟錯', async () => {
    const run = vi.fn().mockResolvedValueOnce({}).mockResolvedValue({})
    mockedCreate.mockResolvedValue({ run, release: vi.fn().mockResolvedValue(undefined) })
    const video = { videoWidth: 640, videoHeight: 360 } as unknown as HTMLVideoElement

    await expect(estimateDepthMap(video)).rejects.toThrow('深度模型沒有回傳深度圖')
  })

  it('cleanMaskWithDepth：帶內人物保留、帶外誤判歸零 → outcome applied', async () => {
    // 遮罩 40x20 = 800 px：前 700 px 是人物（alpha 255），後 100 px 是被
    // 誤判的遠景（alpha 100，低於錨點門檻）。深度圖直接給遮罩解析度。
    const width = 40
    const height = 20
    const depthRaw = new Float32Array(width * height)
    depthRaw.fill(8, 0, 700)
    depthRaw.fill(1, 700)
    sessionWithDepthOutput(depthRaw, [1, height, width])
    const alpha = new Uint8ClampedArray(width * height)
    alpha.fill(255, 0, 700)
    alpha.fill(100, 700)
    const mask: MaskRaster = { width, height, alpha }
    const video = { videoWidth: width * 48, videoHeight: height * 48 } as unknown as HTMLVideoElement

    const result = await cleanMaskWithDepth(video, mask)

    expect(result.outcome).toBe('applied')
    expect([...result.mask.alpha.slice(0, 700)]).toEqual(Array(700).fill(255))
    expect([...result.mask.alpha.slice(700)]).toEqual(Array(100).fill(0))
    // copy semantics：輸入遮罩不得被改動。
    expect(mask.alpha[700]).toBe(100)
  })

  it('cleanMaskWithDepth：錨點不足 → outcome unreliable，遮罩原樣返回（NO-OP）', async () => {
    const width = 40
    const height = 20
    sessionWithDepthOutput(new Float32Array(width * height).fill(3), [1, height, width])
    // alpha 全部低於錨點門檻 → 錨點 0 (< MIN_ANCHOR_PIXELS)。
    const mask: MaskRaster = { width, height, alpha: new Uint8ClampedArray(width * height).fill(120) }
    const video = { videoWidth: 1920, videoHeight: 960 } as unknown as HTMLVideoElement

    const result = await cleanMaskWithDepth(video, mask)

    expect(result.outcome).toBe('unreliable')
    expect(result.mask).toBe(mask)
  })

  it('cleanMaskWithDepth：污染錨點（深度帶過寬）→ outcome unreliable（NO-OP）', async () => {
    const width = 40
    const height = 20
    const depthRaw = new Float32Array(width * height)
    // 錨點一半在近景、一半在遠景 → 正規化後帶寬 ~1 > 0.6。
    depthRaw.fill(10, 0, 400)
    depthRaw.fill(1, 400)
    sessionWithDepthOutput(depthRaw, [1, height, width])
    const mask: MaskRaster = { width, height, alpha: new Uint8ClampedArray(width * height).fill(255) }
    const video = { videoWidth: 1280, videoHeight: 640 } as unknown as HTMLVideoElement

    const result = await cleanMaskWithDepth(video, mask)

    expect(result.outcome).toBe('unreliable')
    expect(result.mask).toBe(mask)
  })
})
