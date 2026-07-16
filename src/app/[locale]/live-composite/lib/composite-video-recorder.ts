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

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (video.readyState >= 2 && Math.abs(video.currentTime - time) <= 0.01) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
    }
    const handleSeeked = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('影片跳轉失敗，無法開始輸出'))
    }
    video.addEventListener('seeked', handleSeeked, { once: true })
    video.addEventListener('error', handleError, { once: true })
    video.currentTime = time
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
    source.connect(context.destination)
    graph = { context, source }
    audioGraphs.set(video, graph)
  }

  if (graph.context.state === 'suspended') await graph.context.resume()
  const destination = graph.context.createMediaStreamDestination()
  graph.source.connect(destination)
  const track = destination.stream.getAudioTracks()[0]
  if (!track) {
    graph.source.disconnect(destination)
    throw new Error('無法建立原音錄製軌道')
  }
  return {
    track,
    disconnect: () => {
      graph?.source.disconnect(destination)
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
}: CompositeRecordingOptions): CompositeRecordingSession {
  let cancelled = false
  let recorder: MediaRecorder | null = null

  const cancel = () => {
    cancelled = true
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
      const canvasStream = canvas.captureStream(fps)
      let audioConnection: Awaited<ReturnType<typeof connectAudio>> | null = null
      let animationFrame = 0
      let stopTimer = 0
      let settled = false
      const chunks: Blob[] = []

      const restore = () => {
        window.cancelAnimationFrame(animationFrame)
        window.clearTimeout(stopTimer)
        video.removeEventListener('ended', handleEnded)
        video.pause()
        video.playbackRate = originalPlaybackRate
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
        await seekVideo(video, 0)
        if (cancelled) throw new CompositeRecordingCancelledError()
        onFrame(0)
        onProgress({ currentTime: 0, duration })

        const render = () => {
          if (settled || cancelled) return
          const time = Math.min(duration, video.currentTime)
          onFrame(time)
          onProgress({ currentTime: time, duration })
          animationFrame = window.requestAnimationFrame(render)
        }

        video.addEventListener('ended', handleEnded)
        recorder.start(250)
        animationFrame = window.requestAnimationFrame(render)
        await video.play()
      } catch (error) {
        if (recorder?.state !== 'inactive') recorder?.stop()
        else finishWithError(error instanceof Error ? error : new Error('影片輸出失敗'))
      }
    })().catch((error: unknown) => {
      reject(error instanceof Error ? error : new Error('影片輸出失敗'))
    })
  })

  return { result, cancel }
}
