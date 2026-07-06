/**
 * contentTypeForKey — 雲端上傳 MIME 標注。
 *
 * 背景:R2/COS 上傳若不帶 ContentType,物件以 application/octet-stream
 * 供應;Safari/iOS <video> 對 MIME 嚴格會拒播 mp4(圖片因 sniffing 倖存),
 * 造成「playground 圖片看得到、影片看不到」。此測試鎖住副檔名映射,
 * 防止 regression。
 */

import { describe, it, expect } from 'vitest'
import { contentTypeForKey } from '@/lib/cos'

describe('contentTypeForKey', () => {
  it('maps video extensions to playable video MIME types', () => {
    expect(contentTypeForKey('images/playground-runs/abc-123.mp4')).toBe('video/mp4')
    expect(contentTypeForKey('video/shot-1.mov')).toBe('video/quicktime')
    expect(contentTypeForKey('video/shot-1.webm')).toBe('video/webm')
  })

  it('maps image extensions', () => {
    expect(contentTypeForKey('images/char-1.jpg')).toBe('image/jpeg')
    expect(contentTypeForKey('images/char-1.jpeg')).toBe('image/jpeg')
    expect(contentTypeForKey('images/char-1.png')).toBe('image/png')
    expect(contentTypeForKey('images/char-1.webp')).toBe('image/webp')
  })

  it('maps audio extensions', () => {
    expect(contentTypeForKey('voice/line-1.mp3')).toBe('audio/mpeg')
    expect(contentTypeForKey('voice/line-1.wav')).toBe('audio/wav')
    expect(contentTypeForKey('voice/line-1.m4a')).toBe('audio/mp4')
  })

  it('is case-insensitive on the extension', () => {
    expect(contentTypeForKey('images/UPPER.MP4')).toBe('video/mp4')
    expect(contentTypeForKey('images/Mixed.Png')).toBe('image/png')
  })

  it('falls back to octet-stream for unknown or missing extensions', () => {
    expect(contentTypeForKey('images/no-extension')).toBe('application/octet-stream')
    expect(contentTypeForKey('images/strange.xyz')).toBe('application/octet-stream')
  })
})
