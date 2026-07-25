/**
 * 深度引導影片的純資料處理。
 *
 * Depth Anything V2 回傳 0–1 的相對逆深度（近＝1、遠＝0）。這裡只做：
 * 1. 相鄰影格時序平滑，降低逐幀正規化造成的亮度閃爍。
 * 2. 轉為 Seedance 可讀的灰階 RGBA 畫面。
 *
 * 不做人物分割，也不把深度圖宣稱為 alpha mask。
 */

export const DEPTH_GUIDE_TARGET_FPS = 12
export const DEPTH_GUIDE_HISTORY_WEIGHT = 0.34
export const DEPTH_GUIDE_MIN_EFFECTIVE_FPS = 6
export const DEPTH_GUIDE_MOTION_THRESHOLD = 0.12
export const DEPTH_GUIDE_MOTION_HISTORY_WEIGHT = 0.05

export function smoothDepthFrame(
  previous: Float32Array | null,
  current: Float32Array,
  historyWeight: number = DEPTH_GUIDE_HISTORY_WEIGHT,
): Float32Array {
  if (!Number.isFinite(historyWeight) || historyWeight < 0 || historyWeight >= 1) {
    throw new Error('深度時序平滑權重需介於 0（含）與 1（不含）之間')
  }
  if (!previous) return new Float32Array(current)
  if (previous.length !== current.length) {
    throw new Error(`相鄰深度影格尺寸不一致：${previous.length} / ${current.length}`)
  }

  const next = new Float32Array(current.length)
  const currentWeight = 1 - historyWeight
  for (let index = 0; index < current.length; index += 1) {
    const value = previous[index] * historyWeight + current[index] * currentWeight
    next[index] = Math.min(1, Math.max(0, value))
  }
  return next
}

/**
 * 靜止區域使用一般 EMA 降低亮度閃爍；深度變化較大的像素視為動作邊緣，
 * 幾乎完全採用當前影格，避免快速手腳留下殘影。
 */
export function stabilizeDepthFrame(
  previous: Float32Array | null,
  current: Float32Array,
): Float32Array {
  if (!previous) return new Float32Array(current)
  if (previous.length !== current.length) {
    throw new Error(`相鄰深度影格尺寸不一致：${previous.length} / ${current.length}`)
  }

  const next = new Float32Array(current.length)
  for (let index = 0; index < current.length; index += 1) {
    const delta = Math.abs(current[index] - previous[index])
    const historyWeight = delta >= DEPTH_GUIDE_MOTION_THRESHOLD
      ? DEPTH_GUIDE_MOTION_HISTORY_WEIGHT
      : DEPTH_GUIDE_HISTORY_WEIGHT
    next[index] = Math.min(
      1,
      Math.max(0, previous[index] * historyWeight + current[index] * (1 - historyWeight)),
    )
  }
  return next
}

export function depthFrameToLuma(depth: Float32Array): Uint8ClampedArray {
  const luma = new Uint8ClampedArray(depth.length)
  for (let index = 0; index < depth.length; index += 1) {
    const value = depth[index]
    if (!Number.isFinite(value)) throw new Error('深度影格包含無效數值')
    luma[index] = Math.round(Math.min(1, Math.max(0, value)) * 255)
  }
  return luma
}

export function depthFrameToRgba(depth: Float32Array): Uint8ClampedArray {
  const luma = depthFrameToLuma(depth)
  const rgba = new Uint8ClampedArray(luma.length * 4)
  for (let index = 0; index < luma.length; index += 1) {
    const gray = luma[index]
    const offset = index * 4
    rgba[offset] = gray
    rgba[offset + 1] = gray
    rgba[offset + 2] = gray
    rgba[offset + 3] = 255
  }
  return rgba
}

export interface DepthGuideQuality {
  effectiveFps: number
  sufficient: boolean
}

export function evaluateDepthGuideQuality(frameCount: number, durationSeconds: number): DepthGuideQuality {
  if (!Number.isInteger(frameCount) || frameCount < 0) throw new Error('深度影格數量無效')
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('深度影片長度無效')
  const effectiveFps = frameCount / durationSeconds
  return {
    effectiveFps,
    sufficient: effectiveFps >= DEPTH_GUIDE_MIN_EFFECTIVE_FPS,
  }
}
