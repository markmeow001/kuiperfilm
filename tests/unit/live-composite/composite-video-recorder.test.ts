import { describe, expect, it } from 'vitest'
import {
  pickCompositeRecorderMime,
  recordingExtension,
} from '@/app/[locale]/live-composite/lib/composite-video-recorder'

describe('live composite video recorder', () => {
  it('瀏覽器支援 VP8 與 MP4 -> 優先選擇含 Opus 的 WebM', () => {
    const supported = new Set(['video/webm;codecs=vp8,opus', 'video/mp4'])
    expect(pickCompositeRecorderMime((mimeType) => supported.has(mimeType))).toBe('video/webm;codecs=vp8,opus')
  })

  it('瀏覽器只支援 MP4 -> 使用 MP4 並產生正確副檔名', () => {
    expect(pickCompositeRecorderMime((mimeType) => mimeType === 'video/mp4')).toBe('video/mp4')
    expect(recordingExtension('video/mp4')).toBe('mp4')
  })

  it('瀏覽器沒有任何可用編碼 -> 明確回傳不支援', () => {
    expect(pickCompositeRecorderMime(() => false)).toBeNull()
    expect(recordingExtension('video/webm')).toBe('webm')
  })
})
