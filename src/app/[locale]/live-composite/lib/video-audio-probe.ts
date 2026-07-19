/**
 * 音訊軌偵測（本機、盡力而為）。
 *
 * 瀏覽器沒有標準 API 可直接判斷影片是否含音訊軌，只能讀非標準訊號：
 * - Firefox：`mozHasAudio`
 * - Safari：`audioTracks.length`
 * - Chromium：`webkitAudioDecodedByteCount`（需實際解碼過才會 >0）
 *
 * 三者皆不可用時回傳 null（「無法偵測」是資料，不是例外——
 * 體檢報告會以 unknown 列顯示，交由使用者自行確認）。
 */

/** 與 HTMLVideoElement 結構相容的最小訊號集合（可在 node 測試）。 */
export interface VideoAudioSignals {
  mozHasAudio?: boolean
  audioTracks?: { length: number }
  webkitAudioDecodedByteCount?: number
}

/** 依可用的非標準訊號判斷是否含音訊；全部缺席時回傳 null。 */
export function resolveHasAudio(signals: VideoAudioSignals): boolean | null {
  if (typeof signals.mozHasAudio === 'boolean') return signals.mozHasAudio
  if (signals.audioTracks && typeof signals.audioTracks.length === 'number') {
    return signals.audioTracks.length > 0
  }
  if (typeof signals.webkitAudioDecodedByteCount === 'number') {
    return signals.webkitAudioDecodedByteCount > 0
  }
  return null
}

const PROBE_LOAD_TIMEOUT_MS = 5_000
/** Chromium 需要實際解碼一小段才會累積 webkitAudioDecodedByteCount。 */
const PROBE_DECODE_WAIT_MS = 150

/**
 * 以離屏 video 元素載入 `url` 並偵測音訊軌。
 * 載入失敗或逾時回傳 null（無法偵測），不拋例外。
 */
export async function probeVideoHasAudio(url: string): Promise<boolean | null> {
  if (typeof document === 'undefined') return null
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = url
  try {
    const loaded = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), PROBE_LOAD_TIMEOUT_MS)
      video.addEventListener(
        'loadeddata',
        () => {
          window.clearTimeout(timer)
          resolve(true)
        },
        { once: true },
      )
      video.addEventListener(
        'error',
        () => {
          window.clearTimeout(timer)
          resolve(false)
        },
        { once: true },
      )
      video.load()
    })
    if (!loaded) return null
    try {
      // 靜音播放一小段，讓 Chromium 開始解碼音訊；被 autoplay 政策拒絕時
      // 仍可退回 metadata 層級的訊號（mozHasAudio / audioTracks）。
      await video.play()
      await new Promise((resolve) => window.setTimeout(resolve, PROBE_DECODE_WAIT_MS))
      video.pause()
    } catch {
      // autoplay 被拒不是錯誤——直接讀取現有訊號。
    }
    return resolveHasAudio(video as unknown as VideoAudioSignals)
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}
