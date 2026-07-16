import { describe, expect, it } from 'vitest'
import { appendStrokePoint, brushPixels, pointerToNormalizedPoint } from '@/app/[locale]/live-composite/lib/mask-strokes'
import type { MaskStroke } from '@/app/[locale]/live-composite/live-composite-types'

describe('live composite mask geometry', () => {
  it('顯示畫布有位移與縮放 -> 指標座標正規化到原始影片比例', () => {
    const point = pointerToNormalizedPoint(350, 225, { left: 100, top: 50, width: 500, height: 350 })
    expect(point).toEqual({ x: 0.5, y: 0.5 })
  })

  it('指標超出顯示畫布 -> 座標限制在遮罩邊界', () => {
    const point = pointerToNormalizedPoint(900, -10, { left: 100, top: 50, width: 500, height: 350 })
    expect(point).toEqual({ x: 1, y: 0 })
  })

  it('橫向影片使用 5% 筆刷 -> 依較短邊換算原始像素', () => {
    expect(brushPixels(0.05, 1920, 1080)).toBe(54)
  })

  it('移動距離低於門檻 -> 不加入重複筆跡點', () => {
    const stroke: MaskStroke = { id: 'stroke-1', tool: 'keep', size: 0.05, points: [{ x: 0.5, y: 0.5 }] }
    const unchanged = appendStrokePoint(stroke, { x: 0.5004, y: 0.5004 })
    expect(unchanged).toBe(stroke)
    expect(unchanged.points).toHaveLength(1)
  })
})
