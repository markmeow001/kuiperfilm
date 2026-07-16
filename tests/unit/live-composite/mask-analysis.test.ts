import { describe, expect, it } from 'vitest'
import { buildMaskAnalysisTimes, confidenceToMaskRaster, selectPersonSegmenterVariant } from '@/app/[locale]/live-composite/lib/mask-analysis'

describe('live composite AI mask analysis', () => {
  it('橫向影片與直式影片 -> 選擇對應的人物分割模型', () => {
    expect(selectPersonSegmenterVariant(1920, 1080)).toBe('landscape')
    expect(selectPersonSegmenterVariant(1080, 1920)).toBe('square')
  })

  it('影片長度不是取樣間隔整數倍 -> 仍包含最後一個影格', () => {
    expect(buildMaskAnalysisTimes(2.4, 1)).toEqual([0, 1, 2, 2.4])
  })

  it('分析影格超過安全上限 -> 明確拒絕而非偷偷減少取樣', () => {
    expect(() => buildMaskAnalysisTimes(100, 0.5, 10)).toThrow('超過上限 10')
  })

  it('零柔化且信心等於門檻 -> 人物像素完全保留', () => {
    const mask = confidenceToMaskRaster(new Float32Array([0.49, 0.5, 0.9]), 3, 1, 0.5, 0)
    expect([...mask.alpha]).toEqual([0, 255, 255])
  })

  it('有邊緣柔化 -> 門檻附近產生半透明而非硬切', () => {
    const mask = confidenceToMaskRaster(new Float32Array([0.4, 0.5, 0.6]), 3, 1, 0.5, 0.1)
    expect(mask.alpha[0]).toBe(0)
    expect(mask.alpha[1]).toBeGreaterThanOrEqual(127)
    expect(mask.alpha[1]).toBeLessThanOrEqual(128)
    expect(mask.alpha[2]).toBe(255)
  })

  it('模型資料尺寸不符 -> 回報具體長度錯誤', () => {
    expect(() => confidenceToMaskRaster(new Float32Array([1]), 2, 2, 0.5, 0.1))
      .toThrow('預期 4，收到 1')
  })
})
