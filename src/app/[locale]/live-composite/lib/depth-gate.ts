/**
 * 深度淨化（depth-assisted mask cleanup）— 純函式、node 可測。
 *
 * 由 Depth Anything V2 的相對逆深度圖（值越大越近，逐幀正規化到 0-1）推導
 * 「人物深度帶」：以遮罩中高信心（alpha ≥ 0.7·255）的像素當深度錨點，取其
 * p2–p98 深度範圍外擴一段邊距，把遮罩中深度落在帶外的誤判像素（建築、
 * 遠景）歸零。
 *
 * 失敗模式鐵則：任何不可靠情況（錨點太少、深度帶過寬）都必須回傳 null →
 * 上層跳過該影格、完全不裁切（NO-OP），並把「未套用」明確呈現給使用者。
 * 絕不允許「寧可多裁」——2026-07-19 pose-bbox 事故的教訓：清理啟發式一旦
 * 誤判，會把人物本體裁掉，比殘留背景嚴重得多。
 */
import type { MaskRaster } from '../live-composite-types'

/** 深度淨化對單一關鍵影格的結果標記（off = 使用者未啟用）。 */
export type DepthGateOutcome = 'applied' | 'unreliable' | 'off'

/** 深度帶外擴邊距（正規化逆深度單位）。產品預設待實測調整（目前沿用 PoC 驗證值）。 */
export const DEPTH_BAND_MARGIN = 0.08
/** 錨點像素下限（於分析解析度）：錨點少於此數時統計不可信 → 回 null 跳過。 */
export const MIN_ANCHOR_PIXELS = 500
/**
 * 深度帶寬上限：帶寬超過此值代表錨點已被污染（同時涵蓋人物與背景的深度，
 * 例如分割遮罩本身就把建築誤判成人），此時 gating 不可靠 → 回 null 跳過。
 */
export const MAX_RELIABLE_BAND_WIDTH = 0.6
/** 錨點 alpha 門檻：alpha ≥ 0.7·255 的像素才算「確定是人物」的深度錨點。 */
export const DEPTH_ANCHOR_ALPHA_MIN = 0.7 * 255
/** 錨點深度分佈取 p2–p98，去除離群值後再外擴邊距。 */
export const DEPTH_ANCHOR_PERCENTILE_LOW = 2
export const DEPTH_ANCHOR_PERCENTILE_HIGH = 98

export interface DepthBand {
  lower: number
  upper: number
}

export interface PersonDepthBandOptions {
  margin?: number
  minAnchorPixels?: number
  maxReliableBandWidth?: number
  anchorAlphaMin?: number
}

/** Linear-interpolated percentile over an ascending-sorted array (p in 0..100). */
function sortedPercentile(sorted: Float32Array, percentile: number): number {
  const rank = (percentile / 100) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]
  const weight = rank - low
  return sorted[low] * (1 - weight) + sorted[high] * weight
}

/**
 * 計算人物深度帶。回傳 null = 深度帶不可靠，上層必須跳過 gating（NO-OP）
 * 並讓使用者知道該影格未套用。
 */
export function computePersonDepthBand(
  depth: Float32Array,
  anchorAlpha: ArrayLike<number>,
  options: PersonDepthBandOptions = {},
): DepthBand | null {
  const margin = options.margin ?? DEPTH_BAND_MARGIN
  const minAnchorPixels = options.minAnchorPixels ?? MIN_ANCHOR_PIXELS
  const maxReliableBandWidth = options.maxReliableBandWidth ?? MAX_RELIABLE_BAND_WIDTH
  const anchorAlphaMin = options.anchorAlphaMin ?? DEPTH_ANCHOR_ALPHA_MIN
  if (depth.length !== anchorAlpha.length) {
    throw new Error(`深度圖與遮罩尺寸不符：深度 ${depth.length}，遮罩 ${anchorAlpha.length}`)
  }
  if (!Number.isFinite(margin) || margin < 0) throw new Error('深度帶邊距無效')
  if (!Number.isInteger(minAnchorPixels) || minAnchorPixels < 1) throw new Error('錨點像素下限無效')
  if (!Number.isFinite(maxReliableBandWidth) || maxReliableBandWidth <= 0) throw new Error('深度帶寬上限無效')

  const anchors: number[] = []
  for (let index = 0; index < depth.length; index += 1) {
    if (anchorAlpha[index] >= anchorAlphaMin) anchors.push(depth[index])
  }
  if (anchors.length < minAnchorPixels) return null

  const sorted = Float32Array.from(anchors).sort()
  const lower = sortedPercentile(sorted, DEPTH_ANCHOR_PERCENTILE_LOW) - margin
  const upper = sortedPercentile(sorted, DEPTH_ANCHOR_PERCENTILE_HIGH) + margin
  if (upper - lower > maxReliableBandWidth) return null
  return { lower, upper }
}

/**
 * 把深度落在人物深度帶外的遮罩像素歸零。copy semantics：回傳新的
 * MaskRaster，絕不改動輸入；帶內像素（含柔邊的中間 alpha 值）原樣保留。
 */
export function applyDepthGate(mask: MaskRaster, depth: Float32Array, band: DepthBand): MaskRaster {
  const expected = mask.width * mask.height
  if (!Number.isInteger(mask.width) || mask.width <= 0 || !Number.isInteger(mask.height) || mask.height <= 0) {
    throw new Error('遮罩尺寸無效，無法套用深度淨化')
  }
  if (mask.alpha.length !== expected) {
    throw new Error(`遮罩資料長度不符：預期 ${expected}，收到 ${mask.alpha.length}`)
  }
  if (depth.length !== expected) {
    throw new Error(`深度圖長度與遮罩不符：預期 ${expected}，收到 ${depth.length}`)
  }
  if (!Number.isFinite(band.lower) || !Number.isFinite(band.upper) || band.upper < band.lower) {
    throw new Error('人物深度帶範圍無效')
  }
  const alpha = new Uint8ClampedArray(mask.alpha)
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] === 0) continue
    const value = depth[index]
    if (value < band.lower || value > band.upper) alpha[index] = 0
  }
  return { width: mask.width, height: mask.height, alpha }
}

/**
 * 最近鄰重取樣：把深度圖（分析解析度，例如長邊 518）放大到遮罩解析度，
 * 讓 computePersonDepthBand / applyDepthGate 在同一座標系運算。
 */
export function resampleDepthNearest(
  src: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Float32Array {
  for (const [label, value] of [['來源寬', srcWidth], ['來源高', srcHeight], ['目標寬', dstWidth], ['目標高', dstHeight]] as const) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`深度圖重取樣尺寸無效（${label}=${value}）`)
  }
  if (src.length !== srcWidth * srcHeight) {
    throw new Error(`深度圖資料長度不符：預期 ${srcWidth * srcHeight}，收到 ${src.length}`)
  }
  if (srcWidth === dstWidth && srcHeight === dstHeight) return src.slice()
  const out = new Float32Array(dstWidth * dstHeight)
  for (let y = 0; y < dstHeight; y += 1) {
    const srcY = Math.min(srcHeight - 1, Math.floor(((y + 0.5) * srcHeight) / dstHeight))
    const srcRow = srcY * srcWidth
    const dstRow = y * dstWidth
    for (let x = 0; x < dstWidth; x += 1) {
      const srcX = Math.min(srcWidth - 1, Math.floor(((x + 0.5) * srcWidth) / dstWidth))
      out[dstRow + x] = src[srcRow + srcX]
    }
  }
  return out
}

/** 掃描完成後的深度淨化彙總訊息（UI 顯示用）。 */
export function formatDepthCleanupSummary(applied: number, total: number, unreliable: number): string {
  for (const value of [applied, total, unreliable]) {
    if (!Number.isInteger(value) || value < 0) throw new Error('深度淨化統計數字無效')
  }
  if (unreliable > 0) {
    return `${applied}/${total} 影格已套用深度淨化（${unreliable} 格深度帶不可靠未套用）`
  }
  return `${applied}/${total} 影格已套用深度淨化`
}
