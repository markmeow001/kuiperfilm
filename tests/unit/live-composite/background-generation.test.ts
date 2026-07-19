import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closestBackgroundAspectRatio,
  downloadGeneratedBackground,
  generatedBackgroundDownloadHref,
} from '@/app/[locale]/live-composite/lib/background-generation'

describe('live composite background generation helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('依實拍尺寸選擇最接近的圖片生成比例', () => {
    expect(closestBackgroundAspectRatio(1920, 1080)).toBe('16:9')
    expect(closestBackgroundAspectRatio(1080, 1920)).toBe('9:16')
    expect(closestBackgroundAspectRatio(1000, 980)).toBe('1:1')
    expect(closestBackgroundAspectRatio()).toBe('16:9')
  })

  it('生成結果下載固定走同源代理並保留 URL 編碼', () => {
    const href = generatedBackgroundDownloadHref('https://cdn.example/image.png?token=a&v=2')
    const params = new URLSearchParams(href.split('?')[1])
    expect(href.startsWith('/api/playground/download?')).toBe(true)
    expect(params.get('url')).toBe('https://cdn.example/image.png?token=a&v=2')
    expect(params.get('filename')).toBe('live-composite-background.png')
  })

  it('下載完成但回傳非圖片 -> 顯式拒絕，不套用假背景', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['bad'], { type: 'text/plain' }),
    }))

    await expect(downloadGeneratedBackground('https://cdn.example/result')).rejects.toThrow('生成結果不是可用的圖片格式')
  })
})
