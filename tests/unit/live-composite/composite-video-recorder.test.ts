import { describe, expect, it, vi } from 'vitest'
import {
  CompositeRecordingCancelledError,
  pickCompositeRecorderMime,
  recordingTimeoutReason,
  recordingExtension,
  seekVideo,
} from '@/app/[locale]/live-composite/lib/composite-video-recorder'

class FakeVideo extends EventTarget {
  readyState = 0
  currentTime = 8
}

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

  it('影片時間超過停滯門檻未前進 -> 停止無限錄影', () => {
    expect(recordingTimeoutReason({
      now: 21_000,
      startedAt: 0,
      lastProgressAt: 500,
      stallTimeoutMs: 20_000,
      maxRuntimeMs: 120_000,
    })).toBe('stalled')
  })

  it('持續有進度但超過總安全時間 -> 仍會停止錄影', () => {
    expect(recordingTimeoutReason({
      now: 121_000,
      startedAt: 0,
      lastProgressAt: 120_500,
      stallTimeoutMs: 20_000,
      maxRuntimeMs: 120_000,
    })).toBe('deadline')
  })

  it('影片持續前進且未超過上限 -> 繼續錄影', () => {
    expect(recordingTimeoutReason({
      now: 30_000,
      startedAt: 0,
      lastProgressAt: 29_500,
      stallTimeoutMs: 20_000,
      maxRuntimeMs: 120_000,
    })).toBeNull()
  })

  it('輸出準備卡在跳轉時取消 -> 立即結束 pending seek', async () => {
    const video = new FakeVideo()
    const controller = new AbortController()
    const pendingSeek = seekVideo(
      video as unknown as HTMLVideoElement,
      0,
      controller.signal,
      20_000,
    )

    controller.abort()

    await expect(pendingSeek).rejects.toBeInstanceOf(CompositeRecordingCancelledError)
  })

  it('輸出準備跳轉沒有完成 -> 在安全時間後明確失敗', async () => {
    vi.useFakeTimers()
    try {
      const video = new FakeVideo()
      const pendingSeek = seekVideo(
        video as unknown as HTMLVideoElement,
        0,
        new AbortController().signal,
        20_000,
      )
      const rejection = expect(pendingSeek).rejects.toThrow('影片跳轉超過 20 秒')

      await vi.advanceTimersByTimeAsync(20_000)

      await rejection
    } finally {
      vi.useRealTimers()
    }
  })
})
