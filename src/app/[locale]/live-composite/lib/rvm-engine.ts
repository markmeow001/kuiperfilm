import { confidenceToMaskRaster } from './mask-analysis'
import { seekVideoForAnalysis } from './mask-stage-utils'
import {
  buildRvmScanPlan,
  chooseDownsampleRatio,
  DEFAULT_RVM_SCAN_FPS,
  nextRecurrentFeeds,
  type RvmRecurrentFeeds,
} from './rvm-scan'
import type { MaskRaster } from '../live-composite-types'

export const RVM_MODEL_PATH = '/models/live-composite/rvm-mobilenetv3-fp32.onnx'
/** onnxruntime-web fetches its .wasm binaries from here (self-hosted, no CDN). */
export const ORT_WASM_ASSET_PATH = '/onnxruntime/'
const FRAME_PRESENT_TIMEOUT_MS = 5_000

export type RvmExecutionProvider = 'webgpu' | 'wasm'

/**
 * Minimal structural view of onnxruntime-web used by this engine. Tests pass
 * a fake module implementing this shape instead of loading the real runtime.
 */
export interface RvmOrtTensor {
  readonly data: unknown
  readonly dims: readonly number[]
  dispose?: () => void
}

export interface RvmOrtSession {
  run: (feeds: Record<string, RvmOrtTensor>) => Promise<Record<string, RvmOrtTensor>>
  release: () => Promise<void>
}

export interface RvmOrtModule {
  env: { wasm: { numThreads?: number; wasmPaths?: string } }
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => RvmOrtTensor
  InferenceSession: {
    create: (path: string, options: { executionProviders: RvmExecutionProvider[] }) => Promise<RvmOrtSession>
  }
}

export interface RvmEngine {
  ort: RvmOrtModule
  session: RvmOrtSession
  ep: RvmExecutionProvider
  epLabel: string
}

export function rvmEpLabel(ep: RvmExecutionProvider): string {
  return ep === 'webgpu' ? 'RVM · WebGPU' : 'RVM · WASM（較慢）'
}

/** Tiny zero-input inference forcing every op to actually resolve on the EP.
 *  Session creation alone lies: JSEP resolves unsupported ops lazily at RUN
 *  time (2026-07-20 field bug — AveragePool ceil_mode blew up on first real
 *  frame while create() had succeeded). */
async function warmupRvmSession(ort: RvmOrtModule, session: RvmOrtSession): Promise<void> {
  const feeds: Record<string, RvmOrtTensor> = {
    src: new ort.Tensor('float32', new Float32Array(3 * 32 * 32), [1, 3, 32, 32]),
    downsample_ratio: new ort.Tensor('float32', new Float32Array([1]), [1]),
  }
  for (const name of ['r1i', 'r2i', 'r3i', 'r4i']) {
    feeds[name] = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
  }
  const outputs = await session.run(feeds)
  for (const tensor of Object.values(outputs)) tensor.dispose?.()
}

/**
 * Tries WebGPU first, then single-threaded WASM (numThreads=1 so no
 * SharedArrayBuffer / COOP-COEP headers are required). Each candidate must
 * pass a warmup inference, not just session creation. If both execution
 * providers fail, throws an explicit error carrying both reasons — there is
 * deliberately NO silent fallback to the Selfie Segmenter engine.
 */
export async function negotiateRvmSession(
  ort: RvmOrtModule,
  modelPath: string,
): Promise<{ session: RvmOrtSession; ep: RvmExecutionProvider }> {
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = ORT_WASM_ASSET_PATH
  const failures: string[] = []
  for (const ep of ['webgpu', 'wasm'] as const) {
    let session: RvmOrtSession | null = null
    try {
      session = await ort.InferenceSession.create(modelPath, { executionProviders: [ep] })
      await warmupRvmSession(ort, session)
      return { session, ep }
    } catch (error) {
      failures.push(`${ep}：${error instanceof Error ? error.message : String(error)}`)
      try {
        await session?.release()
      } catch {
        // Failed-warmup session teardown is best-effort; the EP failure above
        // is what we report.
      }
    }
  }
  throw new Error(`RVM 引擎無法初始化（WebGPU 與 WASM 皆失敗）— ${failures.join('；')}`)
}

let enginePromise: Promise<RvmEngine> | null = null

/** Loads onnxruntime-web + the RVM model once and caches the session. */
export function createRvmSession(): Promise<RvmEngine> {
  enginePromise ??= (async () => {
    const ort = (await import('onnxruntime-web')) as unknown as RvmOrtModule
    const { session, ep } = await negotiateRvmSession(ort, RVM_MODEL_PATH)
    return { ort, session, ep, epLabel: rvmEpLabel(ep) }
  })().catch((error: unknown) => {
    enginePromise = null
    throw error
  })
  return enginePromise
}

/** Releases the cached ONNX session so GPU/WASM memory is freed on unmount. */
export async function releaseRvmSession(): Promise<void> {
  const pending = enginePromise
  enginePromise = null
  if (!pending) return
  try {
    const engine = await pending
    await engine.session.release()
  } catch {
    // Session either failed to initialise (nothing to release) or release()
    // threw during browser teardown; both leave nothing to clean up.
  }
}

export class RvmScanCancelledError extends Error {
  constructor() {
    super('RVM 掃描已取消')
    this.name = 'RvmScanCancelledError'
  }
}

interface RvmFrameResult {
  confidence: Float32Array
  width: number
  height: number
  states: RvmRecurrentFeeds<RvmOrtTensor>
}

function createInitialStates(ort: RvmOrtModule): RvmRecurrentFeeds<RvmOrtTensor> {
  const zero = () => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
  return { r1i: zero(), r2i: zero(), r3i: zero(), r4i: zero() }
}

function disposeStates(states: RvmRecurrentFeeds<RvmOrtTensor>): void {
  for (const tensor of [states.r1i, states.r2i, states.r3i, states.r4i]) tensor.dispose?.()
}

/** Reads video frames into a reused CHW RGB [0,1] buffer for the src tensor. */
function createFrameReader(video: HTMLVideoElement, width: number, height: number): () => Float32Array {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('瀏覽器無法建立影格讀取畫布')
  const plane = width * height
  const chw = new Float32Array(plane * 3)
  return () => {
    context.drawImage(video, 0, 0, width, height)
    const { data } = context.getImageData(0, 0, width, height)
    for (let index = 0; index < plane; index += 1) {
      const offset = index * 4
      chw[index] = data[offset] / 255
      chw[index + plane] = data[offset + 1] / 255
      chw[index + plane * 2] = data[offset + 2] / 255
    }
    return chw
  }
}

async function runRvmFrame(
  engine: RvmEngine,
  frame: Float32Array,
  width: number,
  height: number,
  ratioTensor: RvmOrtTensor,
  states: RvmRecurrentFeeds<RvmOrtTensor>,
): Promise<RvmFrameResult> {
  const src = new engine.ort.Tensor('float32', frame, [1, 3, height, width])
  const outputs = await engine.session.run({ src, ...states, downsample_ratio: ratioTensor })
  const pha = outputs.pha
  if (!pha) throw new Error('RVM 模型沒有回傳 alpha 遮罩（pha）')
  const [, , phaHeight, phaWidth] = pha.dims
  const raw = pha.data
  if (!(raw instanceof Float32Array)) throw new Error('RVM alpha 遮罩不是 float32 資料')
  // Copy before disposing the tensor so the raster survives GPU/WASM cleanup.
  const confidence = raw.slice()
  const next = nextRecurrentFeeds(outputs)
  outputs.fgr?.dispose?.()
  pha.dispose?.()
  src.dispose?.()
  return { confidence, width: phaWidth, height: phaHeight, states: next }
}

type VideoFrameCallbackCapable = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/**
 * Steps the video to `time` and waits for the frame to actually be
 * presented: via requestVideoFrameCallback when the browser supports it,
 * otherwise via the guarded `seeked` fallback used by the selfie path.
 */
function presentVideoFrame(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  const capable = video as VideoFrameCallbackCapable
  if (typeof capable.requestVideoFrameCallback !== 'function') {
    return seekVideoForAnalysis(video, time, signal)
  }
  if (signal.aborted) return Promise.reject(new Error('分析已中止'))
  if (video.readyState >= 2 && Math.abs(video.currentTime - time) <= 0.001) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup()
      reject(new Error(`影片跳轉超過 ${Math.round(FRAME_PRESENT_TIMEOUT_MS / 1_000)} 秒，無法分析指定影格`))
    }, FRAME_PRESENT_TIMEOUT_MS)
    const handle = capable.requestVideoFrameCallback!(() => {
      cleanup()
      resolve()
    })
    const handleAbort = () => {
      cleanup()
      reject(new Error('分析已中止'))
    }
    const cleanup = () => {
      globalThis.clearTimeout(timeout)
      capable.cancelVideoFrameCallback?.(handle)
      signal.removeEventListener('abort', handleAbort)
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    video.currentTime = time
  })
}

/**
 * Single-frame RVM matte (zeroed recurrent state) for the「目前影格」button.
 * Returns the same MaskRaster shape as the selfie path so downstream
 * keyframes / strokes / serialization are untouched.
 */
export async function segmentPersonFrameRvm(
  video: HTMLVideoElement,
  threshold: number,
  edgeSoftness: number,
): Promise<{ mask: MaskRaster; epLabel: string }> {
  const engine = await createRvmSession()
  const width = video.videoWidth
  const height = video.videoHeight
  if (width <= 0 || height <= 0) throw new Error('影片尺寸無效，無法執行 RVM 分析')
  const readFrame = createFrameReader(video, width, height)
  const ratioTensor = new engine.ort.Tensor('float32', new Float32Array([chooseDownsampleRatio(width, height)]), [1])
  const states = createInitialStates(engine.ort)
  try {
    const result = await runRvmFrame(engine, readFrame(), width, height, ratioTensor, states)
    disposeStates(result.states)
    return {
      mask: confidenceToMaskRaster(result.confidence, result.width, result.height, threshold, edgeSoftness),
      epLabel: engine.epLabel,
    }
  } finally {
    disposeStates(states)
    ratioTensor.dispose?.()
  }
}

export interface RvmScanProgress {
  frameIndex: number
  frameCount: number
  processedSeconds: number
  totalSeconds: number
  epLabel: string
}

export interface RvmScanOptions {
  duration: number
  /** Sampling times (from buildMaskAnalysisTimes) that commit keyframes. */
  commitTimes: number[]
  threshold: number
  edgeSoftness: number
  fps?: number
  signal: AbortSignal
  shouldContinue: () => boolean
  onProgress: (progress: RvmScanProgress) => void
}

/**
 * Sequential RVM scan: visits EVERY frame from t=0 to duration exactly once,
 * threading the recurrent state between frames, and commits a keyframe
 * baseMask at each sampling time. Cancellation throws RvmScanCancelledError
 * so partial results are never applied.
 */
export async function scanPersonMasksRvm(
  video: HTMLVideoElement,
  options: RvmScanOptions,
): Promise<Array<{ time: number; mask: MaskRaster }>> {
  const engine = await createRvmSession()
  const width = video.videoWidth
  const height = video.videoHeight
  if (width <= 0 || height <= 0) throw new Error('影片尺寸無效，無法執行 RVM 分析')
  const plan = buildRvmScanPlan(options.duration, options.fps ?? DEFAULT_RVM_SCAN_FPS, options.commitTimes)
  const readFrame = createFrameReader(video, width, height)
  const ratioTensor = new engine.ort.Tensor('float32', new Float32Array([chooseDownsampleRatio(width, height)]), [1])
  let states = createInitialStates(engine.ort)
  const frames: Array<{ time: number; mask: MaskRaster }> = []
  video.pause()
  try {
    for (let index = 0; index < plan.length; index += 1) {
      if (!options.shouldContinue()) throw new RvmScanCancelledError()
      const step = plan[index]
      await presentVideoFrame(video, step.time, options.signal)
      if (!options.shouldContinue()) throw new RvmScanCancelledError()
      const result = await runRvmFrame(engine, readFrame(), width, height, ratioTensor, states)
      disposeStates(states)
      states = result.states
      for (const commitTime of step.commitTimes) {
        frames.push({
          time: commitTime,
          mask: confidenceToMaskRaster(result.confidence, result.width, result.height, options.threshold, options.edgeSoftness),
        })
      }
      options.onProgress({
        frameIndex: index + 1,
        frameCount: plan.length,
        processedSeconds: step.time,
        totalSeconds: options.duration,
        epLabel: engine.epLabel,
      })
      // Yield so progress renders and cancel clicks land between frames.
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
    }
    return frames
  } finally {
    disposeStates(states)
    ratioTensor.dispose?.()
  }
}
