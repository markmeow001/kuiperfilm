import { describe, expect, it } from 'vitest'
import {
  applyDepthGate,
  computePersonDepthBand,
  DEPTH_ANCHOR_ALPHA_MIN,
  DEPTH_BAND_MARGIN,
  formatDepthCleanupSummary,
  MAX_RELIABLE_BAND_WIDTH,
  MIN_ANCHOR_PIXELS,
  resampleDepthNearest,
} from '@/app/[locale]/live-composite/lib/depth-gate'
import type { MaskRaster } from '@/app/[locale]/live-composite/live-composite-types'

/** 建一張 depth / alpha 平行陣列：前 anchorCount 個像素是高信心錨點。 */
function buildAnchoredArrays(total: number, anchorCount: number, anchorDepth: number, backgroundDepth: number) {
  const depth = new Float32Array(total).fill(backgroundDepth)
  const alpha = new Uint8ClampedArray(total)
  for (let index = 0; index < anchorCount; index += 1) {
    depth[index] = anchorDepth
    alpha[index] = 255
  }
  return { depth, alpha }
}

describe('computePersonDepthBand（人物深度帶）', () => {
  it('正常案例：帶 = 錨點 p2−margin 到 p98+margin，背景像素不影響統計', () => {
    const total = 2_000
    const anchorCount = 1_000
    const depth = new Float32Array(total)
    const alpha = new Uint8ClampedArray(total)
    for (let index = 0; index < anchorCount; index += 1) {
      // 錨點深度均勻分佈在 0.5 ~ 0.7。
      depth[index] = 0.5 + (0.2 * index) / (anchorCount - 1)
      alpha[index] = 255
    }
    // 其餘是遠景（深度 0.05）但 alpha=0，不得進入錨點統計。
    for (let index = anchorCount; index < total; index += 1) depth[index] = 0.05

    const band = computePersonDepthBand(depth, alpha)

    expect(band).not.toBeNull()
    // p2 ≈ 0.504、p98 ≈ 0.696（線性插值），margin 0.08。
    expect(band!.lower).toBeCloseTo(0.504 - DEPTH_BAND_MARGIN, 2)
    expect(band!.upper).toBeCloseTo(0.696 + DEPTH_BAND_MARGIN, 2)
  })

  it('錨點門檻是 alpha ≥ 0.7·255：柔邊像素（低 alpha）不算錨點', () => {
    const total = 1_200
    const depth = new Float32Array(total).fill(0.6)
    const alpha = new Uint8ClampedArray(total)
    // 全部像素 alpha 剛好低於門檻 → 錨點數 0 → null。
    alpha.fill(Math.floor(DEPTH_ANCHOR_ALPHA_MIN) - 1)
    expect(computePersonDepthBand(depth, alpha)).toBeNull()
    // 提到門檻以上 → 錨點足夠 → 有帶。
    alpha.fill(Math.ceil(DEPTH_ANCHOR_ALPHA_MIN))
    expect(computePersonDepthBand(depth, alpha)).not.toBeNull()
  })

  it(`錨點不足（< ${MIN_ANCHOR_PIXELS}）→ null（跳過 gating，不得硬算）`, () => {
    const { depth, alpha } = buildAnchoredArrays(2_000, MIN_ANCHOR_PIXELS - 1, 0.6, 0.1)
    expect(computePersonDepthBand(depth, alpha)).toBeNull()
  })

  it('錨點剛好達標 → 回傳深度帶', () => {
    const { depth, alpha } = buildAnchoredArrays(2_000, MIN_ANCHOR_PIXELS, 0.6, 0.1)
    const band = computePersonDepthBand(depth, alpha)
    expect(band).not.toBeNull()
    expect(band!.lower).toBeCloseTo(0.6 - DEPTH_BAND_MARGIN, 5)
    expect(band!.upper).toBeCloseTo(0.6 + DEPTH_BAND_MARGIN, 5)
  })

  it(`污染錨點（帶寬 > ${MAX_RELIABLE_BAND_WIDTH}）→ null：錨點同時涵蓋人物與背景深度時 gating 不可靠`, () => {
    // 一半錨點在 0.05（被誤判成人的建築）、一半在 0.9（真人）→ 帶寬 ~1.0。
    const total = 2_000
    const depth = new Float32Array(total)
    const alpha = new Uint8ClampedArray(total)
    for (let index = 0; index < 1_000; index += 1) {
      depth[index] = index < 500 ? 0.05 : 0.9
      alpha[index] = 255
    }
    expect(computePersonDepthBand(depth, alpha)).toBeNull()
  })

  it('margin/percentile 可由 options 覆寫（產品調參路徑）', () => {
    const { depth, alpha } = buildAnchoredArrays(1_000, 600, 0.5, 0.1)
    const band = computePersonDepthBand(depth, alpha, { margin: 0.2, maxReliableBandWidth: 1 })
    expect(band).not.toBeNull()
    expect(band!.lower).toBeCloseTo(0.3, 5)
    expect(band!.upper).toBeCloseTo(0.7, 5)
  })

  it('深度圖與遮罩長度不符 → 明確丟錯', () => {
    expect(() => computePersonDepthBand(new Float32Array(4), new Uint8ClampedArray(5))).toThrow('深度圖與遮罩尺寸不符')
  })
})

describe('applyDepthGate（copy semantics）', () => {
  const band = { lower: 0.4, upper: 0.8 }

  it('帶內像素保留（含柔邊 alpha 原值）、帶外歸零', () => {
    const mask: MaskRaster = { width: 4, height: 1, alpha: Uint8ClampedArray.of(255, 128, 200, 64) }
    const depth = Float32Array.of(0.6, 0.5, 0.1, 0.95)

    const gated = applyDepthGate(mask, depth, band)

    expect([...gated.alpha]).toEqual([255, 128, 0, 0])
    expect(gated.width).toBe(4)
    expect(gated.height).toBe(1)
  })

  it('絕不改動輸入遮罩（回傳新 raster）', () => {
    const mask: MaskRaster = { width: 2, height: 1, alpha: Uint8ClampedArray.of(255, 255) }
    const depth = Float32Array.of(0.6, 0.05)

    const gated = applyDepthGate(mask, depth, band)

    expect([...mask.alpha]).toEqual([255, 255])
    expect([...gated.alpha]).toEqual([255, 0])
    expect(gated.alpha).not.toBe(mask.alpha)
  })

  it('帶界（剛好等於 lower/upper）視為帶內', () => {
    // 0.5 / 0.75 在 float32 可精確表示，避免邊界比較被浮點誤差污染。
    const exactBand = { lower: 0.5, upper: 0.75 }
    const mask: MaskRaster = { width: 2, height: 1, alpha: Uint8ClampedArray.of(200, 200) }
    const gated = applyDepthGate(mask, Float32Array.of(0.5, 0.75), exactBand)
    expect([...gated.alpha]).toEqual([200, 200])
  })

  it('深度圖長度與遮罩不符 → 明確丟錯', () => {
    const mask: MaskRaster = { width: 2, height: 2, alpha: new Uint8ClampedArray(4) }
    expect(() => applyDepthGate(mask, new Float32Array(3), band)).toThrow('深度圖長度與遮罩不符')
  })

  it('遮罩尺寸與資料不符 / 帶範圍無效 → 明確丟錯', () => {
    const badMask: MaskRaster = { width: 3, height: 1, alpha: new Uint8ClampedArray(2) }
    expect(() => applyDepthGate(badMask, new Float32Array(3), band)).toThrow('遮罩資料長度不符')
    const mask: MaskRaster = { width: 1, height: 1, alpha: new Uint8ClampedArray(1) }
    expect(() => applyDepthGate(mask, new Float32Array(1), { lower: 0.8, upper: 0.4 })).toThrow('人物深度帶範圍無效')
    expect(() => applyDepthGate(mask, new Float32Array(1), { lower: Number.NaN, upper: 0.4 })).toThrow('人物深度帶範圍無效')
  })
})

describe('resampleDepthNearest', () => {
  it('2x2 → 4x4 最近鄰放大', () => {
    const src = Float32Array.of(
      0.1, 0.2,
      0.3, 0.4,
    )
    const out = resampleDepthNearest(src, 2, 2, 4, 4)
    expect([...out]).toEqual([
      0.1, 0.1, 0.2, 0.2,
      0.1, 0.1, 0.2, 0.2,
      0.3, 0.3, 0.4, 0.4,
      0.3, 0.3, 0.4, 0.4,
    ].map((value) => Math.fround(value)))
  })

  it('同尺寸 → 回傳複本而非原陣列', () => {
    const src = Float32Array.of(0.5, 0.6)
    const out = resampleDepthNearest(src, 2, 1, 2, 1)
    expect([...out]).toEqual([...src])
    expect(out).not.toBe(src)
  })

  it('尺寸/長度不符 → 明確丟錯', () => {
    expect(() => resampleDepthNearest(new Float32Array(3), 2, 2, 4, 4)).toThrow('深度圖資料長度不符')
    expect(() => resampleDepthNearest(new Float32Array(4), 2, 2, 0, 4)).toThrow('深度圖重取樣尺寸無效')
  })
})

describe('formatDepthCleanupSummary', () => {
  it('全部套用 → 不顯示不可靠段', () => {
    expect(formatDepthCleanupSummary(12, 12, 0)).toBe('12/12 影格已套用深度淨化')
  })

  it('部分不可靠 → 顯示跳過數量', () => {
    expect(formatDepthCleanupSummary(9, 12, 3)).toBe('9/12 影格已套用深度淨化（3 格深度帶不可靠未套用）')
  })

  it('負數 / 非整數 → 明確丟錯', () => {
    expect(() => formatDepthCleanupSummary(-1, 2, 0)).toThrow('深度淨化統計數字無效')
    expect(() => formatDepthCleanupSummary(1.5, 2, 0)).toThrow('深度淨化統計數字無效')
  })
})
