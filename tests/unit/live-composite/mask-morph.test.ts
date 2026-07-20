import { describe, expect, it } from 'vitest'
import { morphMaskRasters } from '@/app/[locale]/live-composite/lib/mask-morph'
import type { MaskRaster } from '@/app/[locale]/live-composite/live-composite-types'

function raster(alpha: number[], width: number): MaskRaster {
  return { width, height: alpha.length / width, alpha: new Uint8ClampedArray(alpha) }
}

describe('morphMaskRasters（soft alpha 關鍵影格插值）', () => {
  it('progress 0 / 1 -> 直接回傳 before / after，柔邊不動', () => {
    const before = raster([0, 120, 240], 3)
    const after = raster([0, 40, 80], 3)
    expect(morphMaskRasters(before, after, 0)).toBe(before)
    expect(morphMaskRasters(before, after, 1)).toBe(after)
  })

  it('相同外框的柔邊遮罩 -> 中點是連續插值，不會被壓成 0/255 二值', () => {
    // 兩張遮罩可見範圍相同（x=1..2），只有 alpha 濃度不同：
    // morph 應逐像素線性插值柔邊值。
    const before = raster([0, 120, 240], 3)
    const after = raster([0, 40, 80], 3)

    const mid = morphMaskRasters(before, after, 0.5)

    expect(mid.alpha[0]).toBe(0)
    expect(mid.alpha[1]).toBe(80)
    expect(mid.alpha[2]).toBe(160)
  })

  it('兩張相同的柔邊遮罩 -> 任何進度都保留原本的漸層', () => {
    const soft = raster([0, 64, 128, 191, 255], 5)
    const mid = morphMaskRasters(soft, raster([0, 64, 128, 191, 255], 5), 0.4)
    expect([...mid.alpha]).toEqual([0, 64, 128, 191, 255])
  })

  it('尺寸不相容 -> 保留 before（沿用既有行為，柔邊不受影響）', () => {
    const before = raster([0, 128], 2)
    const after = raster([0, 128, 255], 3)
    expect(morphMaskRasters(before, after, 0.5)).toBe(before)
  })
})
