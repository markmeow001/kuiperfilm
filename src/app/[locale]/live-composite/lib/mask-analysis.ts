import type { MaskRaster } from '../live-composite-types'

export const MAX_MASK_ANALYSIS_SAMPLES = 180
export type PersonSegmenterVariant = 'landscape' | 'square'

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function selectPersonSegmenterVariant(width: number, height: number): PersonSegmenterVariant {
  if (width <= 0 || height <= 0) throw new Error('影片尺寸無效，無法選擇人物分割模型')
  return width / height >= 1.2 ? 'landscape' : 'square'
}

export function buildMaskAnalysisTimes(
  duration: number,
  interval: number,
  maxSamples: number = MAX_MASK_ANALYSIS_SAMPLES,
): number[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('影片長度無效')
  if (!Number.isFinite(interval) || interval <= 0) throw new Error('分析間隔必須大於 0')
  if (!Number.isInteger(maxSamples) || maxSamples < 1) throw new Error('分析影格上限無效')

  const sampleCount = Math.floor(duration / interval) + 1
  const includesEnd = Math.abs((sampleCount - 1) * interval - duration) > 0.02
  const total = sampleCount + (includesEnd ? 1 : 0)
  if (total > maxSamples) {
    throw new Error(`這段影片會產生 ${total} 個分析影格，超過上限 ${maxSamples}；請提高取樣間隔`)
  }

  const times = Array.from({ length: sampleCount }, (_, index) =>
    Math.round(Math.min(duration, index * interval) * 100) / 100,
  )
  if (includesEnd) times.push(Math.round(duration * 100) / 100)
  return times
}

function assertMaskConversionInput(
  confidence: Float32Array,
  width: number,
  height: number,
  threshold: number,
  edgeSoftness: number,
): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('AI 遮罩尺寸無效')
  }
  if (confidence.length !== width * height) {
    throw new Error(`AI 遮罩資料長度不符：預期 ${width * height}，收到 ${confidence.length}`)
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('人物信心門檻必須介於 0 到 1')
  }
  if (!Number.isFinite(edgeSoftness) || edgeSoftness < 0 || edgeSoftness > 0.5) {
    throw new Error('邊緣柔化必須介於 0 到 0.5')
  }
}

export function confidenceToMaskRaster(
  confidence: Float32Array,
  width: number,
  height: number,
  threshold: number,
  edgeSoftness: number,
): MaskRaster {
  assertMaskConversionInput(confidence, width, height, threshold, edgeSoftness)

  const alpha = new Uint8ClampedArray(confidence.length)
  if (edgeSoftness === 0) {
    confidence.forEach((value, index) => {
      alpha[index] = value >= threshold ? 255 : 0
    })
    return { width, height, alpha }
  }

  const lower = threshold - edgeSoftness
  const range = edgeSoftness * 2
  confidence.forEach((value, index) => {
    const normalized = clamp01((value - lower) / range)
    const smooth = normalized * normalized * (3 - 2 * normalized)
    alpha[index] = Math.round(smooth * 255)
  })
  return { width, height, alpha }
}

/**
 * RVM 專用的柔邊轉換：門檻是「透明度下限（alpha floor）」而非二值化開關。
 *
 * 語義：
 * - alpha' = 模型原生 alpha（信心值 ×255），當信心 >= 門檻；否則 0。
 *   門檻以上完整保留 RVM matte 的柔和漸層（頭髮絲、動態模糊邊）。
 * - 邊緣柔化（edgeSoftness）是額外羽化：只在門檻 ± edgeSoftness 區間用
 *   smoothstep 衰減原生 alpha，避免 cutoff 處出現硬階梯；高於
 *   門檻 + edgeSoftness 的像素原生 alpha 1:1 通過。
 * - edgeSoftness = 0 時是純 floor：低於門檻歸零、其餘保留原生柔邊。
 *
 * Selfie Segmenter 路徑仍走 confidenceToMaskRaster（二值／smoothstep
 * 重映射行為不變）。
 */
export function confidenceToSoftMaskRaster(
  confidence: Float32Array,
  width: number,
  height: number,
  threshold: number,
  edgeSoftness: number,
): MaskRaster {
  assertMaskConversionInput(confidence, width, height, threshold, edgeSoftness)

  const alpha = new Uint8ClampedArray(confidence.length)
  if (edgeSoftness === 0) {
    confidence.forEach((value, index) => {
      alpha[index] = value >= threshold ? Math.round(clamp01(value) * 255) : 0
    })
    return { width, height, alpha }
  }

  const lower = threshold - edgeSoftness
  const range = edgeSoftness * 2
  confidence.forEach((value, index) => {
    const normalized = clamp01((value - lower) / range)
    const feather = normalized * normalized * (3 - 2 * normalized)
    alpha[index] = Math.round(clamp01(value) * feather * 255)
  })
  return { width, height, alpha }
}

export function maskRasterToImageData(raster: MaskRaster): ImageData {
  const rgba = new Uint8ClampedArray(raster.width * raster.height * 4)
  raster.alpha.forEach((alpha, index) => {
    const offset = index * 4
    rgba[offset] = 255
    rgba[offset + 1] = 255
    rgba[offset + 2] = 255
    rgba[offset + 3] = alpha
  })
  return new ImageData(rgba, raster.width, raster.height)
}
