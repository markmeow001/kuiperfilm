import { describe, expect, it } from 'vitest'
import { centerCropRect, outpaintGeometry } from '@/app/[locale]/canvas/lib/canvas-image-edit'

describe('canvas image edit geometry', () => {
  it('横图裁成正方形 -> 从中央裁掉左右，不缩放来源', () => {
    expect(centerCropRect(1600, 900, '1:1')).toEqual({ left: 350, top: 0, width: 900, height: 900 })
  })

  it('竖图裁成 16:9 -> 从中央裁掉上下', () => {
    expect(centerCropRect(900, 1600, '16:9')).toEqual({ left: 0, top: 547, width: 900, height: 506 })
  })

  it('正方形扩成 16:9 -> 原图居中，新增区域只在左右', () => {
    expect(outpaintGeometry(1024, 1024, '16:9')).toEqual({
      width: 1821,
      height: 1024,
      source: { left: 398, top: 0, width: 1024, height: 1024 },
    })
  })

  it('非法比例 -> 显式失败', () => {
    expect(() => centerCropRect(100, 100, 'auto')).toThrow('CANVAS_IMAGE_ASPECT_INVALID:auto')
  })
})
