import {
  startCompositeRecording,
  type CompositeRecordingResult,
  type CompositeRecordingSession,
} from './composite-video-recorder'
import { estimateDepthMap, type DepthMap } from './depth-engine'
import {
  DEPTH_GUIDE_TARGET_FPS,
  depthFrameToLuma,
  evaluateDepthGuideQuality,
  stabilizeDepthFrame,
} from './depth-guide-frame'
import { seekVideoForAnalysis } from './mask-stage-utils'

export type DepthGuideProgressPhase = 'analyzing' | 'recording'

export interface DepthGuideProgress {
  phase: DepthGuideProgressPhase
  completedFrames: number
  totalFrames: number
  currentTime: number
  duration: number
  message: string
}

export interface DepthGuideRecordingResult extends CompositeRecordingResult {
  depthFrameCount: number
  effectiveDepthFps: number
  sufficient: boolean
}

export interface DepthGuideRecordingSession {
  result: Promise<DepthGuideRecordingResult>
  cancel: () => void
}

export class DepthGuideRecordingCancelledError extends Error {
  constructor() {
    super('深度影片建立已取消')
    this.name = 'DepthGuideRecordingCancelledError'
  }
}

interface DepthGuideRecordingOptions {
  video: HTMLVideoElement
  duration: number
  includeAudio: boolean
  onProgress: (progress: DepthGuideProgress) => void
  targetFps?: number
  estimate?: (source: HTMLVideoElement) => Promise<DepthMap>
}

export function buildDepthGuideSampleTimes(duration: number, fps: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('深度影片長度無效')
  if (!Number.isFinite(fps) || fps <= 0 || fps > 30) throw new Error('深度取樣幀率需介於 0–30 fps')
  const frameCount = Math.max(1, Math.ceil(duration * fps))
  return Array.from({ length: frameCount }, (_, index) =>
    Math.min(Math.max(0, duration - 0.001), index / fps))
}

function paintLumaFrame(
  context: CanvasRenderingContext2D,
  luma: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  if (luma.length !== width * height) throw new Error('深度影格尺寸不符')
  const image = context.createImageData(width, height)
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * 4
    const value = luma[index]
    image.data[offset] = value
    image.data[offset + 1] = value
    image.data[offset + 2] = value
    image.data[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
}

function restoreVideo(video: HTMLVideoElement, time: number, wasPaused: boolean): void {
  video.pause()
  video.currentTime = time
  if (!wasPaused) void video.play().catch(() => undefined)
}

/**
 * 先逐格完成本機深度推論，再用原片播放時鐘錄製灰階影片。
 * 推論不與錄影同時進行，避免設備較慢時錄出卡住或缺幀的參考片。
 */
export function startDepthGuideRecording({
  video,
  duration,
  includeAudio,
  onProgress,
  targetFps = DEPTH_GUIDE_TARGET_FPS,
  estimate = estimateDepthMap,
}: DepthGuideRecordingOptions): DepthGuideRecordingSession {
  const abortController = new AbortController()
  let recordingSession: CompositeRecordingSession | null = null
  let cancelled = false

  const cancel = () => {
    cancelled = true
    abortController.abort()
    recordingSession?.cancel()
  }

  const result = (async (): Promise<DepthGuideRecordingResult> => {
    const originalTime = video.currentTime
    const wasPaused = video.paused
    const sampleTimes = buildDepthGuideSampleTimes(duration, targetFps)
    const frames: Uint8ClampedArray[] = []
    let width = 0
    let height = 0
    let previous: Float32Array | null = null

    video.pause()
    try {
      for (let index = 0; index < sampleTimes.length; index += 1) {
        if (cancelled) throw new DepthGuideRecordingCancelledError()
        const time = sampleTimes[index]
        onProgress({
          phase: 'analyzing',
          completedFrames: index,
          totalFrames: sampleTimes.length,
          currentTime: time,
          duration,
          message: `正在計算深度 ${index + 1} / ${sampleTimes.length}`,
        })
        await seekVideoForAnalysis(video, time, abortController.signal)
        const map = await estimate(video)
        if (index === 0) {
          width = map.width
          height = map.height
        } else if (map.width !== width || map.height !== height) {
          throw new Error('深度模型輸出尺寸在處理途中改變')
        }
        previous = stabilizeDepthFrame(previous, map.depth)
        frames.push(depthFrameToLuma(previous))
        onProgress({
          phase: 'analyzing',
          completedFrames: index + 1,
          totalFrames: sampleTimes.length,
          currentTime: time,
          duration,
          message: `已計算 ${index + 1} / ${sampleTimes.length} 個深度影格`,
        })
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
      }

      if (cancelled) throw new DepthGuideRecordingCancelledError()
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('瀏覽器無法建立深度影片畫布')
      paintLumaFrame(context, frames[0], width, height)

      await seekVideoForAnalysis(video, originalTime, abortController.signal)
      let paintedIndex = -1
      recordingSession = startCompositeRecording({
        canvas,
        video,
        duration,
        includeAudio,
        fps: 24,
        onFrame: (time) => {
          const frameIndex = Math.min(frames.length - 1, Math.floor(time * targetFps))
          if (frameIndex === paintedIndex) return
          paintLumaFrame(context, frames[frameIndex], width, height)
          paintedIndex = frameIndex
        },
        onProgress: ({ currentTime, duration: recordingDuration }) => {
          onProgress({
            phase: 'recording',
            completedFrames: frames.length,
            totalFrames: frames.length,
            currentTime,
            duration: recordingDuration,
            message: `正在封裝深度影片 ${currentTime.toFixed(1)} / ${recordingDuration.toFixed(1)} 秒`,
          })
        },
        onRestore: () => undefined,
      })
      const recording = await recordingSession.result
      const quality = evaluateDepthGuideQuality(frames.length, duration)
      return {
        ...recording,
        depthFrameCount: frames.length,
        effectiveDepthFps: quality.effectiveFps,
        sufficient: quality.sufficient,
      }
    } catch (error) {
      if (cancelled) throw new DepthGuideRecordingCancelledError()
      throw error
    } finally {
      recordingSession = null
      restoreVideo(video, originalTime, wasPaused)
    }
  })()

  return { result, cancel }
}
