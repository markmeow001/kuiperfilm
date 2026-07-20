/**
 * Depth Anything V2 Small（ONNX，Apache-2.0）— 深度淨化引擎。
 *
 * 只在關鍵影格 commit 時執行（每段影片 12–45 次推理），絕不逐掃描幀跑。
 * 推理契約（DA-V2 ViT-S）：
 * - 輸入 `pixel_values` [1,3,H,W]，RGB 經 ImageNet mean/std 正規化，
 *   H/W 必須是 14 的倍數（長邊 ≈ 518）。
 * - 輸出 `predicted_depth` 為相對逆深度（值越大越近），逐幀正規化到
 *   0-1 後才交給 depth-gate 使用。
 *
 * EP 協商 / warmup / 快取釋放模式與 rvm-engine 完全一致（onnx-session）。
 * 影片與深度圖都留在瀏覽器本機，不上傳。
 */
import {
  negotiateOnnxSession,
  type OnnxExecutionProvider,
  type OnnxModule,
  type OnnxSession,
} from './onnx-session'
import {
  applyDepthGate,
  computePersonDepthBand,
  resampleDepthNearest,
  type DepthGateOutcome,
} from './depth-gate'
import type { MaskRaster } from '../live-composite-types'

export const DEPTH_MODEL_PATH = '/models/live-composite/depth-anything-v2-small.onnx'
/** 分析解析度：長邊縮放到 ≈518（模型訓練解析度），兩邊都取 14 的倍數。 */
export const DEPTH_INPUT_LONG_SIDE = 518
export const DEPTH_INPUT_MULTIPLE = 14

const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const
const IMAGENET_STD = [0.229, 0.224, 0.225] as const

export interface DepthEngine {
  ort: OnnxModule
  session: OnnxSession
  ep: OnnxExecutionProvider
}

export interface DepthMap {
  /** 相對逆深度，逐幀正規化到 0-1（值越大越近）。 */
  depth: Float32Array
  width: number
  height: number
}

/** 深度分析輸入尺寸：長邊 ≈ DEPTH_INPUT_LONG_SIDE，兩邊皆為 14 的倍數。 */
export function computeDepthInputSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('影片尺寸無效，無法計算深度分析解析度')
  }
  const scale = DEPTH_INPUT_LONG_SIDE / Math.max(width, height)
  const toMultiple = (value: number) =>
    Math.max(DEPTH_INPUT_MULTIPLE, Math.round((value * scale) / DEPTH_INPUT_MULTIPLE) * DEPTH_INPUT_MULTIPLE)
  return { width: toMultiple(width), height: toMultiple(height) }
}

/** RGBA 像素 → CHW float32，套 ImageNet mean/std 正規化（DA-V2 輸入契約）。 */
export function rgbaToImageNetTensorData(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = width * height
  if (rgba.length !== plane * 4) {
    throw new Error(`深度輸入像素長度不符：預期 ${plane * 4}，收到 ${rgba.length}`)
  }
  const chw = new Float32Array(plane * 3)
  for (let index = 0; index < plane; index += 1) {
    const offset = index * 4
    chw[index] = (rgba[offset] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0]
    chw[index + plane] = (rgba[offset + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1]
    chw[index + plane * 2] = (rgba[offset + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2]
  }
  return chw
}

/**
 * 相對逆深度逐幀正規化到 0-1。深度圖完全平坦（極端退化）時回傳全 0.5：
 * 此時人物深度帶會涵蓋所有像素，gating 自然退化為 NO-OP，不會誤裁人物。
 */
export function normalizeInverseDepth(raw: Float32Array): Float32Array {
  if (raw.length === 0) throw new Error('深度圖為空，無法正規化')
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index]
    if (!Number.isFinite(value)) throw new Error('深度圖包含無效數值，無法正規化')
    if (value < min) min = value
    if (value > max) max = value
  }
  const range = max - min
  const out = new Float32Array(raw.length)
  if (range <= 1e-9) {
    out.fill(0.5)
    return out
  }
  for (let index = 0; index < raw.length; index += 1) {
    out[index] = (raw[index] - min) / range
  }
  return out
}

/** 與 RVM 相同的鐵則：warmup 推理必過，session 建立成功不算數。 */
async function warmupDepthSession(ort: OnnxModule, session: OnnxSession): Promise<void> {
  const size = DEPTH_INPUT_MULTIPLE * 3
  const feeds = {
    pixel_values: new ort.Tensor('float32', new Float32Array(3 * size * size), [1, 3, size, size]),
  }
  const outputs = await session.run(feeds)
  for (const tensor of Object.values(outputs)) tensor.dispose?.()
}

/** WebGPU → 單執行緒 WASM；兩者皆敗時帶原因明確丟錯（不靜默跳過深度淨化）。 */
export async function negotiateDepthSession(
  ort: OnnxModule,
  modelPath: string,
): Promise<{ session: OnnxSession; ep: OnnxExecutionProvider }> {
  return negotiateOnnxSession(ort, modelPath, {
    warmup: warmupDepthSession,
    buildFailureError: (failures) => `深度引擎無法初始化（WebGPU 與 WASM 皆失敗）— ${failures}`,
  })
}

let enginePromise: Promise<DepthEngine> | null = null

/** 首次啟用深度淨化的掃描才載入模型（lazy），之後快取共用同一 session。 */
export function createDepthSession(): Promise<DepthEngine> {
  enginePromise ??= (async () => {
    const ort = (await import('onnxruntime-web')) as unknown as OnnxModule
    const { session, ep } = await negotiateDepthSession(ort, DEPTH_MODEL_PATH)
    return { ort, session, ep }
  })().catch((error: unknown) => {
    enginePromise = null
    throw error
  })
  return enginePromise
}

/** Releases the cached ONNX session so GPU/WASM memory is freed on unmount. */
export async function releaseDepthSession(): Promise<void> {
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

function sourceDimensions(source: HTMLVideoElement | HTMLCanvasElement): { width: number; height: number } {
  const video = source as Partial<HTMLVideoElement>
  if (typeof video.videoWidth === 'number' && typeof video.videoHeight === 'number') {
    return { width: video.videoWidth, height: video.videoHeight }
  }
  const canvas = source as HTMLCanvasElement
  return { width: canvas.width, height: canvas.height }
}

/** 對目前呈現中的影格估一張正規化逆深度圖（分析解析度，不上傳）。 */
export async function estimateDepthMap(source: HTMLVideoElement | HTMLCanvasElement): Promise<DepthMap> {
  const engine = await createDepthSession()
  const dims = sourceDimensions(source)
  const { width, height } = computeDepthInputSize(dims.width, dims.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('瀏覽器無法建立深度分析畫布')
  context.drawImage(source, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  const input = new engine.ort.Tensor('float32', rgbaToImageNetTensorData(data, width, height), [1, 3, height, width])
  const outputs = await engine.session.run({ pixel_values: input })
  try {
    const predicted = outputs.predicted_depth
    if (!predicted) throw new Error('深度模型沒有回傳深度圖（predicted_depth）')
    const raw = predicted.data
    if (!(raw instanceof Float32Array)) throw new Error('深度圖不是 float32 資料')
    const outHeight = predicted.dims[predicted.dims.length - 2]
    const outWidth = predicted.dims[predicted.dims.length - 1]
    if (!Number.isInteger(outWidth) || outWidth <= 0 || !Number.isInteger(outHeight) || outHeight <= 0 || raw.length !== outWidth * outHeight) {
      throw new Error(`深度圖尺寸無效：dims=[${predicted.dims.join(',')}]，資料長度 ${raw.length}`)
    }
    return { depth: normalizeInverseDepth(raw), width: outWidth, height: outHeight }
  } finally {
    for (const tensor of Object.values(outputs)) tensor.dispose?.()
    input.dispose?.()
  }
}

/**
 * 深度淨化單一關鍵影格遮罩：來源必須仍呈現該遮罩所屬的影格。
 * 深度帶不可靠時回傳原遮罩 + 'unreliable'（NO-OP，絕不誤裁人物）。
 */
export async function cleanMaskWithDepth(
  source: HTMLVideoElement | HTMLCanvasElement,
  mask: MaskRaster,
): Promise<{ mask: MaskRaster; outcome: Exclude<DepthGateOutcome, 'off'> }> {
  const map = await estimateDepthMap(source)
  const depthAtMask = resampleDepthNearest(map.depth, map.width, map.height, mask.width, mask.height)
  const band = computePersonDepthBand(depthAtMask, mask.alpha)
  if (!band) return { mask, outcome: 'unreliable' }
  return { mask: applyDepthGate(mask, depthAtMask, band), outcome: 'applied' }
}
