/**
 * MaskRaster <-> PNG 往返（soft alpha 序列化契約）。
 *
 * 真正的 PNG 編解碼只能在瀏覽器跑；PNG 本身是無損格式、alpha channel 是
 * 8-bit 連續值，不會二值化。這裡用假 canvas / fetch / createImageBitmap
 * 管線鎖住「我們自己的程式碼」在存檔與載入兩端都原樣搬運 soft alpha —
 * 任何一端偷偷加門檻／二值化都會讓這些測試失敗。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPngAsMaskRaster, maskRasterToPngBlob } from '@/app/[locale]/live-composite/lib/mask-raster-png'
import type { MaskRaster } from '@/app/[locale]/live-composite/live-composite-types'

interface StoredPixels {
  rgba: Uint8ClampedArray
  width: number
  height: number
}

class FakeImageData {
  readonly height: number
  constructor(readonly data: Uint8ClampedArray, readonly width: number) {
    this.height = data.length / 4 / width
  }
}

const blobPixels = new WeakMap<Blob, StoredPixels>()
const bitmapPixels = new WeakMap<object, StoredPixels>()

function installFakeCanvasPipeline(): void {
  vi.stubGlobal('ImageData', FakeImageData)
  vi.stubGlobal('document', {
    createElement: () => {
      let stored: StoredPixels | null = null
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          putImageData: (imageData: FakeImageData) => {
            stored = { rgba: imageData.data, width: imageData.width, height: imageData.height }
          },
          drawImage: (bitmap: object) => {
            stored = bitmapPixels.get(bitmap) ?? null
          },
          getImageData: () => {
            if (!stored) throw new Error('fake canvas 沒有畫過任何內容')
            return { data: stored.rgba }
          },
        }),
        toBlob: (callback: (blob: Blob | null) => void) => {
          if (!stored) {
            callback(null)
            return
          }
          const blob = new Blob(['fake-png'])
          blobPixels.set(blob, stored)
          callback(blob)
        },
      }
    },
  })
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    const stored = blobPixels.get(blob)
    if (!stored) throw new Error('未知的 fake PNG blob')
    const bitmap = { width: stored.width, height: stored.height, close: vi.fn() }
    bitmapPixels.set(bitmap, stored)
    return bitmap
  })
}

describe('mask raster PNG 往返（soft alpha）', () => {
  beforeEach(installFakeCanvasPipeline)
  afterEach(() => vi.unstubAllGlobals())

  it('RVM soft alpha 存成 PNG 再載回 -> 每個柔邊值原樣保留，沒有任何一端二值化', async () => {
    const soft: MaskRaster = {
      width: 4,
      height: 2,
      alpha: new Uint8ClampedArray([0, 3, 64, 128, 153, 191, 254, 255]),
    }
    const blob = await maskRasterToPngBlob(soft)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }))

    const restored = await fetchPngAsMaskRaster('https://example.test/mask.png')

    expect({ width: restored.width, height: restored.height }).toEqual({ width: 4, height: 2 })
    expect([...restored.alpha]).toEqual([0, 3, 64, 128, 153, 191, 254, 255])
  })

  it('下載失敗 -> 帶 HTTP 狀態碼的明確錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    await expect(fetchPngAsMaskRaster('https://example.test/mask.png')).rejects.toThrow('AI 遮罩下載失敗（HTTP 403）')
  })
})
