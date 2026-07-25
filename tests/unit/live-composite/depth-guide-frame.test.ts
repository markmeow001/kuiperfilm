import { describe, expect, it } from 'vitest'
import {
  depthFrameToLuma,
  depthFrameToRgba,
  evaluateDepthGuideQuality,
  stabilizeDepthFrame,
  smoothDepthFrame,
} from '@/app/[locale]/live-composite/lib/depth-guide-frame'

describe('深度引導影格', () => {
  it('相鄰深度影格 -> 依指定歷史權重平滑且不改寫輸入', () => {
    const previous = new Float32Array([0, 1])
    const current = new Float32Array([1, 0])

    const smoothed = smoothDepthFrame(previous, current, 0.75)

    expect([...smoothed]).toEqual([0.25, 0.75])
    expect([...previous]).toEqual([0, 1])
    expect([...current]).toEqual([1, 0])
  })

  it('0–1 逆深度 -> 近白遠黑且輸出不透明 RGBA', () => {
    const rgba = depthFrameToRgba(new Float32Array([0, 0.5, 1]))

    expect([...rgba]).toEqual([
      0, 0, 0, 255,
      128, 128, 128, 255,
      255, 255, 255, 255,
    ])
  })

  it('灰階儲存格式只保留單通道，避免完整影片佔用四倍記憶體', () => {
    expect([...depthFrameToLuma(new Float32Array([0, 0.5, 1]))]).toEqual([0, 128, 255])
  })

  it('快速變動像素偏重當前影格，靜止區域才做較強平滑', () => {
    const previous = new Float32Array([0.5, 0])
    const current = new Float32Array([0.52, 1])

    const stabilized = stabilizeDepthFrame(previous, current)

    expect(stabilized[0]).toBeCloseTo(0.5132, 4)
    expect(stabilized[1]).toBeCloseTo(0.95, 4)
  })

  it('12 秒只產生 60 個深度影格 -> 明確標記低於 6fps 品質門檻', () => {
    expect(evaluateDepthGuideQuality(60, 12)).toEqual({
      effectiveFps: 5,
      sufficient: false,
    })
  })
})
