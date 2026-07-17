import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CompositeRecordingCancelledError,
  pickCompositeRecorderMime,
  recordingTimeoutReason,
  recordingExtension,
  seekVideo,
  startCompositeRecording,
} from '@/app/[locale]/live-composite/lib/composite-video-recorder'

class FakeVideo extends EventTarget {
  readyState = 0
  currentTime = 8
}

class FakeRecordingVideo extends EventTarget {
  readyState = 2
  currentTime = 0
  paused = true
  playbackRate = 1
  volume = 1
  pause = vi.fn()
  play = vi.fn(async () => undefined)
}

class FakeAudioContext {
  state = 'running'
  destination = {}
  createMediaElementSource = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  createGain = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } })
  createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [{ stop: vi.fn() }] } })
  close = async () => undefined
}

function makeFakeCanvas(): HTMLCanvasElement {
  return {
    captureStream: () => ({
      addTrack: vi.fn(),
      getVideoTracks: () => [],
    }),
  } as unknown as HTMLCanvasElement
}

function startRecordingWithFakes(video: FakeRecordingVideo, onRestore = vi.fn()) {
  return startCompositeRecording({
    canvas: makeFakeCanvas(),
    video: video as unknown as HTMLVideoElement,
    duration: 4,
    includeAudio: true,
    onFrame: vi.fn(),
    onProgress: vi.fn(),
    onRestore,
  })
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

  describe('錄影器建立前的失敗與取消', () => {
    beforeEach(() => {
      vi.stubGlobal('MediaRecorder', class {
        static isTypeSupported = () => true
      })
      vi.stubGlobal('window', {
        cancelAnimationFrame: vi.fn(),
        clearTimeout: vi.fn(),
        requestAnimationFrame: vi.fn(() => 1),
        setTimeout: vi.fn(() => 1),
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('保留原音但沒有 AudioContext -> 結果承諾立即失敗而非永遠卡住', async () => {
      // AudioContext 未 stub：connectAudio 會在 MediaRecorder 建立前拋錯。
      const video = new FakeRecordingVideo()
      const onRestore = vi.fn()

      const session = startRecordingWithFakes(video, onRestore)

      await expect(session.result).rejects.toThrow('目前瀏覽器無法保留原音')
      expect(onRestore).toHaveBeenCalledTimes(1)
    })

    it('MediaRecorder 建立前取消 -> 結果承諾以取消錯誤結束', async () => {
      vi.stubGlobal('AudioContext', FakeAudioContext)
      const video = new FakeRecordingVideo()
      const onRestore = vi.fn()

      const session = startRecordingWithFakes(video, onRestore)
      session.cancel()

      await expect(session.result).rejects.toBeInstanceOf(CompositeRecordingCancelledError)
      expect(onRestore).toHaveBeenCalledTimes(1)
    })
  })
})
