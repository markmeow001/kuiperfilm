import { describe, expect, it } from 'vitest'
import {
  buildCanvasImportHref,
  clearCanvasImportAssetFromHref,
  parseCanvasImportIntent,
} from '@/app/[locale]/canvas/lib/canvas-import-intent'

describe('canvas import intent', () => {
  it('canvas + asset 参数完整 -> 建立跨工作区导入意图', () => {
    expect(parseCanvasImportIntent({ canvas: ' canvas-1 ', asset: 'asset-1' })).toEqual({ canvasId: 'canvas-1', assetId: 'asset-1' })
    expect(parseCanvasImportIntent({ canvas: ['canvas-1'], asset: 'asset-1' })).toBeNull()
  })

  it('Live Composite 输出 -> 产生编码后的画布导入网址', () => {
    expect(buildCanvasImportHref('zh-TW', { canvasId: 'canvas/1', assetId: 'asset 1' }))
      .toBe('/zh-TW/canvas?canvas=canvas%2F1&asset=asset+1')
  })

  it('节点建立完成 -> 只清除一次性 asset 参数并保留目标画布', () => {
    expect(clearCanvasImportAssetFromHref('https://example.test/zh/canvas?canvas=canvas-1&asset=asset-1#top'))
      .toBe('/zh/canvas?canvas=canvas-1#top')
  })
})
