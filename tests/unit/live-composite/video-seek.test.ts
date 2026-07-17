import { describe, expect, it, vi } from 'vitest'
import { seekVideoGuarded, type SeekVideoGuardOptions } from '@/app/[locale]/live-composite/lib/video-seek'

class FakeVideo extends EventTarget {
  readyState = 0
  currentTime = 8
}

function makeOptions(signal: AbortSignal, timeoutMs: number): SeekVideoGuardOptions {
  return {
    signal,
    timeoutMs,
    createTimeoutError: (timeoutSeconds) => new Error(`影片跳轉超過 ${timeoutSeconds} 秒，無法分析指定影格`),
    createSeekFailedError: () => new Error('影片跳轉失敗，無法分析指定影格'),
    createAbortError: () => new Error('分析已中止'),
  }
}

describe('seekVideoGuarded', () => {
  it('影片元素完成跳轉 -> 正常結束', async () => {
    const video = new FakeVideo()
    const pendingSeek = seekVideoGuarded(video as unknown as HTMLVideoElement, 2, makeOptions(new AbortController().signal, 5_000))

    video.dispatchEvent(new Event('seeked'))

    await expect(pendingSeek).resolves.toBeUndefined()
    expect(video.currentTime).toBe(2)
  })

  it('分析中途中止 -> 立即以中止錯誤結束 pending seek', async () => {
    const video = new FakeVideo()
    const controller = new AbortController()
    const pendingSeek = seekVideoGuarded(video as unknown as HTMLVideoElement, 0, makeOptions(controller.signal, 5_000))

    controller.abort()

    await expect(pendingSeek).rejects.toThrow('分析已中止')
  })

  it('跳轉停滯（例如影片來源被更換）-> 數秒後明確失敗而非永遠等待', async () => {
    vi.useFakeTimers()
    try {
      const video = new FakeVideo()
      const pendingSeek = seekVideoGuarded(video as unknown as HTMLVideoElement, 0, makeOptions(new AbortController().signal, 5_000))
      const rejection = expect(pendingSeek).rejects.toThrow('影片跳轉超過 5 秒，無法分析指定影格')

      await vi.advanceTimersByTimeAsync(5_000)

      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('影片元素回報錯誤 -> 以跳轉失敗錯誤結束', async () => {
    const video = new FakeVideo()
    const pendingSeek = seekVideoGuarded(video as unknown as HTMLVideoElement, 0, makeOptions(new AbortController().signal, 5_000))

    video.dispatchEvent(new Event('error'))

    await expect(pendingSeek).rejects.toThrow('影片跳轉失敗，無法分析指定影格')
  })
})
