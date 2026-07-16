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

export function confidenceToMaskRaster(
  confidence: Float32Array,
  width: number,
  height: number,
  threshold: number,
  edgeSoftness: number,
): MaskRaster {
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
