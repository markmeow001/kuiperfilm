import { seekVideoGuarded } from './video-seek'

export interface CompositeRecordingProgress {
  currentTime: number
  duration: number
}

export interface CompositeRecordingResult {
  blob: Blob
  mimeType: string
  extension: 'mp4' | 'webm'
}

export interface CompositeRecordingSession {
  result: Promise<CompositeRecordingResult>
  cancel: () => void
}

interface AudioGraph {
  context: AudioContext
  source: MediaElementAudioSourceNode
  monitor: GainNode
}

interface CompositeRecordingOptions {
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  duration: number
  includeAudio: boolean
  fps?: number
  onFrame: (time: number) => void
  onProgress: (progress: CompositeRecordingProgress) => void
  onRestore: () => void
  preparationTimeoutMs?: number
  stallTimeoutMs?: number
  maxRuntimeMs?: number
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
] as const

const audioGraphs = new WeakMap<HTMLVideoElement, AudioGraph>()
const DEFAULT_PREPARATION_TIMEOUT_MS = 20_000
const DEFAULT_STALL_TIMEOUT_MS = 20_000

export class CompositeRecordingCancelledError extends Error {
  constructor() {
    super('影片輸出已取消')
    this.name = 'CompositeRecordingCancelledError'
  }
}

export function pickCompositeRecorderMime(
  isTypeSupported: (mimeType: string) => boolean = (mimeType) => MediaRecorder.isTypeSupported(mimeType),
): string | null {
  for (const mimeType of MIME_CANDIDATES) {
    if (isTypeSupported(mimeType)) return mimeType
  }
  return null
}

export function recordingExtension(mimeType: string): 'mp4' | 'webm' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

export function recordingTimeoutReason(options: {
  now: number
  startedAt: number
  lastProgressAt: number
  stallTimeoutMs: number
  maxRuntimeMs: number
}): 'stalled' | 'deadline' | null {
  if (options.now - options.startedAt > options.maxRuntimeMs) return 'deadline'
  if (options.now - options.lastProgressAt > options.stallTimeoutMs) return 'stalled'
  return null
}

export async function releaseCompositeRecordingAudio(video: HTMLVideoElement): Promise<void> {
  const graph = audioGraphs.get(video)
  if (!graph) return
  audioGraphs.delete(video)
  try {
    graph.source.disconnect()
  } catch {
    // The source may already have been disconnected by browser teardown.
  }
  try {
    graph.monitor.disconnect()
  } catch {
    // The monitor may already have been disconnected by browser teardown.
  }
  if (graph.context.state !== 'closed') {
    try {
      await graph.context.close()
    } catch {
      // Closing an already-tearing-down context is best-effort cleanup.
    }
  }
}

export function seekVideo(
  video: HTMLVideoElement,
  time: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  return seekVideoGuarded(video, time, {
    signal,
    timeoutMs,
    createTimeoutError: (timeoutSeconds) => new Error(`影片跳轉超過 ${timeoutSeconds} 秒，無法開始輸出`),
    createSeekFailedError: () => new Error('影片跳轉失敗，無法開始輸出'),
    createAbortError: () => new CompositeRecordingCancelledError(),
  })
}

async function connectAudio(video: HTMLVideoElement): Promise<{
  track: MediaStreamTrack
  disconnect: () => void
}> {
  if (typeof AudioContext === 'undefined') {
    throw new Error('目前瀏覽器無法保留原音；請關閉「保留原音」後再輸出')
  }

  let graph = audioGraphs.get(video)
  if (!graph) {
    const context = new AudioContext()
    const source = context.createMediaElementSource(video)
    const monitor = context.createGain()
    source.connect(monitor)
    monitor.connect(context.destination)
    graph = { context, source, monitor }
    audioGraphs.set(video, graph)
  }

  if (graph.context.state === 'suspended') await graph.context.resume()
  graph.monitor.gain.value = 0
  const destination = graph.context.createMediaStreamDestination()
  graph.source.connect(destination)
  const track = destination.stream.getAudioTracks()[0]
  if (!track) {
    graph.source.disconnect(destination)
    graph.monitor.gain.value = 1
    throw new Error('無法建立原音錄製軌道')
  }
  return {
    track,
    disconnect: () => {
      graph?.source.disconnect(destination)
      if (graph) graph.monitor.gain.value = 1
      track.stop()
    },
  }
}

export function startCompositeRecording({
  canvas,
  video,
  duration,
  includeAudio,
  fps = 30,
  onFrame,
  onProgress,
  onRestore,
  preparationTimeoutMs = DEFAULT_PREPARATION_TIMEOUT_MS,
  stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
  maxRuntimeMs = Math.max(60_000, duration * 2_000 + 30_000),
}: CompositeRecordingOptions): CompositeRecordingSession {
  let cancelled = false
  let recorder: MediaRecorder | null = null
  const preparationController = new AbortController()

  const cancel = () => {
    cancelled = true
    preparationController.abort()
    video.pause()
    if (recorder?.state !== 'inactive') recorder?.stop()
  }

  const result = new Promise<CompositeRecordingResult>((resolve, reject) => {
    void (async () => {
      if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
        throw new Error('目前瀏覽器不支援本機影片輸出（MediaRecorder / captureStream）')
      }
      const mimeType = pickCompositeRecorderMime()
      if (!mimeType) throw new Error('目前瀏覽器沒有可用的影片編碼格式')

      const originalTime = video.currentTime
      const wasPaused = video.paused
      const originalPlaybackRate = video.playbackRate
      const originalVolume = video.volume
      const canvasStream = canvas.captureStream(fps)
      let audioConnection: Awaited<ReturnType<typeof connectAudio>> | null = null
      let animationFrame = 0
      let stopTimer = 0
      let settled = false
      let startedAt = 0
      let lastProgressAt = 0
      let lastMediaTime = 0
      const chunks: Blob[] = []

      const restore = () => {
        window.cancelAnimationFrame(animationFrame)
        window.clearTimeout(stopTimer)
        video.removeEventListener('ended', handleEnded)
        video.pause()
        video.playbackRate = originalPlaybackRate
        video.volume = originalVolume
        video.currentTime = originalTime
        for (const track of canvasStream.getVideoTracks()) track.stop()
        audioConnection?.disconnect()
        onRestore()
        if (!wasPaused) void video.play().catch(() => undefined)
      }

      const finishWithError = (error: Error) => {
        if (settled) return
        settled = true
        restore()
        reject(error)
      }

      const abortWithError = (error: Error) => {
        if (settled) return
        finishWithError(error)
        if (recorder?.state !== 'inactive') recorder?.stop()
      }

      const handleEnded = () => {
        onFrame(duration)
        onProgress({ currentTime: duration, duration })
        stopTimer = window.setTimeout(() => {
          if (recorder?.state !== 'inactive') recorder?.stop()
        }, 80)
      }

      try {
        if (includeAudio) {
          audioConnection = await connectAudio(video)
          canvasStream.addTrack(audioConnection.track)
        } else {
          video.volume = 0
        }
        if (cancelled) throw new CompositeRecordingCancelledError()

        recorder = new MediaRecorder(canvasStream, {
          mimeType,
          videoBitsPerSecond: 12_000_000,
          audioBitsPerSecond: includeAudio ? 192_000 : undefined,
        })
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        }
        recorder.onerror = (event) => {
          const recorderError = (event as ErrorEvent).error
          finishWithError(new Error(`影片輸出失敗：${recorderError instanceof Error ? recorderError.message : '未知錯誤'}`))
        }
        recorder.onstop = () => {
          if (settled) return
          if (cancelled) {
            finishWithError(new CompositeRecordingCancelledError())
            return
          }
          if (chunks.length === 0) {
            finishWithError(new Error('影片輸出結果為空，請重試'))
            return
          }
          settled = true
          restore()
          const baseMimeType = mimeType.split(';')[0]
          resolve({
            blob: new Blob(chunks, { type: baseMimeType }),
            mimeType: baseMimeType,
            extension: recordingExtension(baseMimeType),
          })
        }

        video.pause()
        video.playbackRate = 1
        await seekVideo(video, 0, preparationController.signal, preparationTimeoutMs)
        if (cancelled) throw new CompositeRecordingCancelledError()
        onFrame(0)
        onProgress({ currentTime: 0, duration })

        const render = () => {
          if (settled || cancelled) return
          const time = Math.min(duration, video.currentTime)
          const now = performance.now()
          if (time > lastMediaTime + 0.01) {
            lastMediaTime = time
            lastProgressAt = now
          }
          const timeoutReason = recordingTimeoutReason({
            now,
            startedAt,
            lastProgressAt,
            stallTimeoutMs,
            maxRuntimeMs,
          })
          if (timeoutReason === 'stalled') {
            abortWithError(new Error(`影片播放已停滯超過 ${Math.round(stallTimeoutMs / 1_000)} 秒，輸出已停止`))
            return
          }
          if (timeoutReason === 'deadline') {
            abortWithError(new Error('影片輸出超過安全時間上限，已自動停止'))
            return
          }
          onFrame(time)
          onProgress({ currentTime: time, duration })
          animationFrame = window.requestAnimationFrame(render)
        }

        video.addEventListener('ended', handleEnded)
        recorder.start(250)
        startedAt = performance.now()
        lastProgressAt = startedAt
        lastMediaTime = 0
        animationFrame = window.requestAnimationFrame(render)
        await video.play()
      } catch (error) {
        const recordingError = cancelled
          ? new CompositeRecordingCancelledError()
          : error instanceof Error
            ? error
            : new Error('影片輸出失敗')
        // The recorder may not exist yet (cancel or failure during preparation,
        // e.g. while connecting audio), so settle the result promise explicitly
        // instead of relying on recorder.onstop — otherwise the promise would
        // never resolve and the page would stay locked in the exporting state.
        abortWithError(recordingError)
      }
    })().catch((error: unknown) => {
      reject(error instanceof Error ? error : new Error('影片輸出失敗'))
    })
  })

  return { result, cancel }
}
