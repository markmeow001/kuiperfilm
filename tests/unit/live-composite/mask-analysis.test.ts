import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildMaskAnalysisTimes,
  confidenceToMaskRaster,
  confidenceToSoftMaskRaster,
  maskRasterToImageData,
  selectPersonSegmenterVariant,
} from '@/app/[locale]/live-composite/lib/mask-analysis'

describe('live composite AI mask analysis', () => {
  it('橫向影片與直式影片 -> 選擇對應的人物分割模型', () => {
    expect(selectPersonSegmenterVariant(1920, 1080)).toBe('landscape')
    expect(selectPersonSegmenterVariant(1080, 1920)).toBe('square')
  })

  it('影片長度不是取樣間隔整數倍 -> 仍包含最後一個影格', () => {
    expect(buildMaskAnalysisTimes(2.4, 1)).toEqual([0, 1, 2, 2.4])
  })

  it('支援 0.25 秒精細取樣', () => {
    expect(buildMaskAnalysisTimes(1, 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1])
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

describe('confidenceToSoftMaskRaster（RVM alpha floor 語義）', () => {
  it('零柔化 -> 門檻是透明度下限：門檻以下歸零，以上保留原生漸層而非二值化', () => {
    const mask = confidenceToSoftMaskRaster(new Float32Array([1, 0.6, 0.5, 0.4, 0.2]), 5, 1, 0.5, 0)
    // 0.6 -> 153、0.5 -> 128：柔邊保留；0.4 / 0.2 低於門檻 -> 0。
    expect([...mask.alpha]).toEqual([255, 153, 128, 0, 0])
  })

  it('門檻 0 + 零柔化 -> 完整保留模型原生 soft alpha', () => {
    const mask = confidenceToSoftMaskRaster(new Float32Array([0, 0.25, 0.5, 0.75, 1]), 5, 1, 0, 0)
    expect([...mask.alpha]).toEqual([0, 64, 128, 191, 255])
  })

  it('有邊緣柔化 -> cutoff 附近羽化衰減，門檻+柔化以上原生 alpha 1:1 通過', () => {
    const mask = confidenceToSoftMaskRaster(new Float32Array([0.9, 0.5, 0.35]), 3, 1, 0.5, 0.1)
    // 0.9 高於 0.6（門檻+柔化）：原生 alpha 通過 = round(float32(0.9)*255) = 229。
    expect(mask.alpha[0]).toBe(229)
    // 0.5 位於門檻正中：smoothstep = 0.5，原生 alpha 128 衰減到一半左右。
    expect(mask.alpha[1]).toBeGreaterThan(0)
    expect(mask.alpha[1]).toBeLessThan(128)
    // 0.35 低於 門檻-柔化：完全去除。
    expect(mask.alpha[2]).toBe(0)
  })

  it('信心超出 [0,1] 的模型輸出 -> clamp 而非溢位', () => {
    const mask = confidenceToSoftMaskRaster(new Float32Array([1.2, -0.1]), 2, 1, 0.5, 0)
    expect([...mask.alpha]).toEqual([255, 0])
  })

  it('與 Selfie 路徑對照：同一份輸入，舊轉換仍是二值化（行為不變）', () => {
    const input = new Float32Array([0.6, 0.4])
    expect([...confidenceToMaskRaster(input, 2, 1, 0.5, 0).alpha]).toEqual([255, 0])
    expect([...confidenceToSoftMaskRaster(input, 2, 1, 0.5, 0).alpha]).toEqual([153, 0])
  })

  it('模型資料尺寸不符 -> 與舊轉換同樣回報具體長度錯誤', () => {
    expect(() => confidenceToSoftMaskRaster(new Float32Array([1]), 2, 2, 0.5, 0.1))
      .toThrow('預期 4，收到 1')
  })
})

describe('maskRasterToImageData（合成乘法的 alpha 載體）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('soft alpha 1:1 寫入 ImageData alpha channel（canvas destination-in 以此乘上前景）', () => {
    // 合成路徑用 destination-in 對遮罩 canvas 做 per-pixel alpha 乘法；
    // 這裡驗證柔邊值原樣進入該 canvas 的 alpha channel，不會被二值化。
    class FakeImageData {
      readonly height: number
      constructor(readonly data: Uint8ClampedArray, readonly width: number) {
        this.height = data.length / 4 / width
      }
    }
    vi.stubGlobal('ImageData', FakeImageData)

    const imageData = maskRasterToImageData({ width: 3, height: 1, alpha: new Uint8ClampedArray([0, 128, 255]) })
    expect([imageData.data[3], imageData.data[7], imageData.data[11]]).toEqual([0, 128, 255])
    // RGB 固定白色，柔邊只由 alpha 表達。
    expect([imageData.data[4], imageData.data[5], imageData.data[6]]).toEqual([255, 255, 255])
  })
})
