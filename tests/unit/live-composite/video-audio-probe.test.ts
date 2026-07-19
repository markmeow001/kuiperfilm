import { describe, expect, it } from 'vitest'
import { resolveHasAudio } from '@/app/[locale]/live-composite/lib/video-audio-probe'

describe('video audio probe — resolveHasAudio', () => {
  it('Firefox mozHasAudio 優先且直接採用', () => {
    expect(resolveHasAudio({ mozHasAudio: true, webkitAudioDecodedByteCount: 0 })).toBe(true)
    expect(resolveHasAudio({ mozHasAudio: false, audioTracks: { length: 2 } })).toBe(false)
  })

  it('Safari audioTracks.length 判斷有無音訊', () => {
    expect(resolveHasAudio({ audioTracks: { length: 1 } })).toBe(true)
    expect(resolveHasAudio({ audioTracks: { length: 0 } })).toBe(false)
  })

  it('Chromium webkitAudioDecodedByteCount >0 視為有音訊', () => {
    expect(resolveHasAudio({ webkitAudioDecodedByteCount: 4096 })).toBe(true)
    expect(resolveHasAudio({ webkitAudioDecodedByteCount: 0 })).toBe(false)
  })

  it('三種訊號都不存在 -> null（無法偵測是資料，不是例外）', () => {
    expect(resolveHasAudio({})).toBe(null)
  })
})
