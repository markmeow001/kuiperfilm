'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { maskRasterToImageData } from './lib/mask-analysis'
import { resolveMaskKeyframe } from './lib/mask-keyframes'
import { appendStrokePoint, pointerToNormalizedPoint, renderMaskStrokes } from './lib/mask-strokes'
import { segmentPersonFrame } from './lib/person-segmenter'
import { shouldRenderPreview } from './lib/render-ownership'
import { seekVideoGuarded } from './lib/video-seek'
import {
  releaseCompositeRecordingAudio,
  startCompositeRecording,
  type CompositeRecordingProgress,
  type CompositeRecordingResult,
  type CompositeRecordingSession,
} from './lib/composite-video-recorder'
import type { CompositeView, MaskKeyframe, MaskRaster, MaskStroke, MaskTool, VideoMetadata } from './live-composite-types'

export interface MaskStageHandle {
  exportMask: () => Promise<Blob>
  exportCompositeFrame: () => Promise<Blob>
  exportCompositeVideo: (options: {
    includeAudio: boolean
    onProgress: (progress: CompositeRecordingProgress) => void
  }) => Promise<CompositeRecordingResult>
  cancelCompositeVideo: () => void
  seekTo: (time: number) => void
  analyzePersonAt: (time: number, threshold: number, edgeSoftness: number) => Promise<MaskRaster>
}

interface MaskStageProps {
  videoUrl: string | null
  videoName: string | null
  backgroundUrl: string | null
  backgroundColor: string
  metadata: VideoMetadata | null
  keyframes: MaskKeyframe[]
  baseMask?: MaskRaster
  strokes: MaskStroke[]
  tool: MaskTool
  brushPercent: number
  view: CompositeView
  overlayVisible: boolean
  editingDisabled?: boolean
  onMetadata: (metadata: VideoMetadata) => void
  onCommitStroke: (stroke: MaskStroke) => void
  onTimeChange: (time: number) => void
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('無法建立 PNG 輸出'))
    }, 'image/png')
  })
}

function drawCover(context: CanvasRenderingContext2D, image: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number): void {
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
}

const ANALYSIS_SEEK_TIMEOUT_MS = 5_000

function seekVideoForAnalysis(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  return seekVideoGuarded(video, time, {
    signal,
    timeoutMs: ANALYSIS_SEEK_TIMEOUT_MS,
    createTimeoutError: (timeoutSeconds) => new Error(`影片跳轉超過 ${timeoutSeconds} 秒，無法分析指定影格`),
    createSeekFailedError: () => new Error('影片跳轉失敗，無法分析指定影格'),
    createAbortError: () => new Error('分析已中止'),
  })
}

export const MaskStage = forwardRef<MaskStageHandle, MaskStageProps>(function MaskStage({
  videoUrl,
  videoName,
  backgroundUrl,
  backgroundColor,
  metadata,
  keyframes,
  baseMask,
  strokes,
  tool,
  brushPercent,
  view,
  overlayVisible,
  editingDisabled = false,
  onMetadata,
  onCommitStroke,
  onTimeChange,
}: MaskStageProps, ref) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const rasterCanvasRef = useRef<{ raster: MaskRaster; canvas: HTMLCanvasElement } | null>(null)
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const backgroundImageRef = useRef<HTMLImageElement | null>(null)
  const currentStrokeRef = useRef<MaskStroke | null>(null)
  const recordingSessionRef = useRef<CompositeRecordingSession | null>(null)
  const analysisAbortRef = useRef<AbortController | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [stageError, setStageError] = useState<string | null>(null)

  const paintMask = useCallback((
    activeStroke: MaskStroke | null = currentStrokeRef.current,
    baseStrokes: MaskStroke[] = strokes,
    raster: MaskRaster | undefined = baseMask,
  ) => {
    const maskCanvas = maskCanvasRef.current
    const context = maskCanvas?.getContext('2d')
    if (!maskCanvas || !context) return
    context.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    if (raster) {
      let cached = rasterCanvasRef.current
      if (!cached || cached.raster !== raster) {
        const canvas = document.createElement('canvas')
        canvas.width = raster.width
        canvas.height = raster.height
        const rasterContext = canvas.getContext('2d')
        if (!rasterContext) throw new Error('無法建立 AI 遮罩畫布')
        rasterContext.putImageData(maskRasterToImageData(raster), 0, 0)
        cached = { raster, canvas }
        rasterCanvasRef.current = cached
      }
      context.drawImage(cached.canvas, 0, 0, maskCanvas.width, maskCanvas.height)
    }
    renderMaskStrokes(
      context,
      activeStroke ? [...baseStrokes, activeStroke] : baseStrokes,
      maskCanvas.width,
      maskCanvas.height,
      false,
    )
  }, [baseMask, strokes])

  const renderScene = useCallback((viewOverride?: CompositeView, showOverlay: boolean = overlayVisible) => {
    const video = videoRef.current
    const display = displayCanvasRef.current
    const mask = maskCanvasRef.current
    const work = workCanvasRef.current
    if (!video || !display || !mask || !work || video.readyState < 2) return
    const context = display.getContext('2d')
    const workContext = work.getContext('2d')
    if (!context || !workContext) return

    const activeView = viewOverride ?? view
    const { width, height } = display
    context.clearRect(0, 0, width, height)

    if (activeView === 'mask') {
      context.fillStyle = '#000000'
      context.fillRect(0, 0, width, height)
      context.drawImage(mask, 0, 0)
      return
    }

    if (activeView === 'source') {
      context.drawImage(video, 0, 0, width, height)
    } else {
      context.fillStyle = backgroundColor
      context.fillRect(0, 0, width, height)
      const background = backgroundImageRef.current
      if (background?.complete && background.naturalWidth > 0) {
        drawCover(context, background, background.naturalWidth, background.naturalHeight, width, height)
      }
      workContext.clearRect(0, 0, width, height)
      workContext.globalCompositeOperation = 'source-over'
      workContext.drawImage(video, 0, 0, width, height)
      workContext.globalCompositeOperation = 'destination-in'
      workContext.drawImage(mask, 0, 0)
      workContext.globalCompositeOperation = 'source-over'
      context.drawImage(work, 0, 0)
    }

    if (showOverlay) {
      workContext.clearRect(0, 0, width, height)
      workContext.globalCompositeOperation = 'source-over'
      workContext.drawImage(mask, 0, 0)
      workContext.globalCompositeOperation = 'source-in'
      workContext.fillStyle = '#fb4b6b'
      workContext.fillRect(0, 0, width, height)
      workContext.globalCompositeOperation = 'source-over'
      context.save()
      context.globalAlpha = 0.36
      context.drawImage(work, 0, 0)
      context.restore()
    }
  }, [backgroundColor, overlayVisible, view])

  useEffect(() => {
    if (!metadata) return
    const display = displayCanvasRef.current
    const mask = maskCanvasRef.current
    if (!display || !mask) return
    display.width = metadata.width
    display.height = metadata.height
    mask.width = metadata.width
    mask.height = metadata.height
    const work = document.createElement('canvas')
    work.width = metadata.width
    work.height = metadata.height
    workCanvasRef.current = work
  }, [metadata])

  useEffect(() => {
    if (!shouldRenderPreview(Boolean(recordingSessionRef.current))) return
    paintMask(null)
    renderScene()
  }, [metadata, paintMask, renderScene])

  useEffect(() => {
    backgroundImageRef.current = null
    if (!backgroundUrl) {
      if (shouldRenderPreview(Boolean(recordingSessionRef.current))) renderScene()
      return
    }
    const image = new Image()
    image.onload = () => {
      backgroundImageRef.current = image
      if (shouldRenderPreview(Boolean(recordingSessionRef.current))) renderScene()
    }
    image.onerror = () => setStageError('背景圖片無法讀取')
    image.src = backgroundUrl
    return () => {
      image.onload = null
      image.onerror = null
    }
  }, [backgroundUrl, renderScene])

  useEffect(() => {
    if (!shouldRenderPreview(Boolean(recordingSessionRef.current))) return
    if (!playing) {
      renderScene()
      return
    }
    let animationFrame = 0
    const tick = () => {
      if (!shouldRenderPreview(Boolean(recordingSessionRef.current))) return
      const playbackTime = videoRef.current?.currentTime ?? 0
      const keyframe = resolveMaskKeyframe(keyframes, playbackTime)
      paintMask(null, keyframe?.strokes ?? [], keyframe?.baseMask)
      renderScene()
      animationFrame = window.requestAnimationFrame(tick)
    }
    animationFrame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [keyframes, paintMask, playing, renderScene])

  useEffect(() => () => {
    analysisAbortRef.current?.abort()
    const recordingSession = recordingSessionRef.current
    recordingSession?.cancel()
    const video = videoRef.current
    if (!video) return
    if (recordingSession) {
      void recordingSession.result
        .catch(() => undefined)
        .finally(() => releaseCompositeRecordingAudio(video))
      return
    }
    void releaseCompositeRecordingAudio(video)
  }, [])

  useImperativeHandle(ref, () => ({
    exportMask: async () => {
      const mask = maskCanvasRef.current
      if (!mask || !metadata) throw new Error('請先載入影片並建立遮罩')
      return canvasBlob(mask)
    },
    exportCompositeFrame: async () => {
      const display = displayCanvasRef.current
      if (!display || !metadata) throw new Error('請先載入影片')
      renderScene('composite', false)
      const blob = await canvasBlob(display)
      renderScene()
      return blob
    },
    exportCompositeVideo: async ({ includeAudio, onProgress }) => {
      const video = videoRef.current
      const display = displayCanvasRef.current
      if (!video || !display || !metadata) throw new Error('請先載入影片')
      if (backgroundUrl && !backgroundImageRef.current) throw new Error('背景圖片仍在載入，請稍後再輸出')
      if (recordingSessionRef.current) throw new Error('目前已有影片正在輸出')

      const session = startCompositeRecording({
        canvas: display,
        video,
        duration: metadata.duration,
        includeAudio,
        onProgress,
        onFrame: (time) => {
          const keyframe = resolveMaskKeyframe(keyframes, time)
          paintMask(null, keyframe?.strokes ?? [], keyframe?.baseMask)
          renderScene('composite', false)
        },
        onRestore: () => {
          const keyframe = resolveMaskKeyframe(keyframes, video.currentTime)
          paintMask(null, keyframe?.strokes ?? [], keyframe?.baseMask)
          renderScene()
        },
      })
      recordingSessionRef.current = session
      try {
        return await session.result
      } finally {
        if (recordingSessionRef.current === session) recordingSessionRef.current = null
      }
    },
    cancelCompositeVideo: () => recordingSessionRef.current?.cancel(),
    seekTo: (time: number) => {
      const video = videoRef.current
      if (!video) return
      video.pause()
      video.currentTime = time
      setCurrentTime(time)
      onTimeChange(time)
    },
    analyzePersonAt: async (time: number, threshold: number, edgeSoftness: number) => {
      const video = videoRef.current
      if (!video || !metadata) throw new Error('請先載入可分析的影片')
      analysisAbortRef.current ??= new AbortController()
      video.pause()
      await seekVideoForAnalysis(video, Math.min(metadata.duration, Math.max(0, time)), analysisAbortRef.current.signal)
      return segmentPersonFrame(video, threshold, edgeSoftness)
    },
  }), [backgroundUrl, keyframes, metadata, onTimeChange, paintMask, renderScene])

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return pointerToNormalizedPoint(event.clientX, event.clientY, rect)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!metadata || editingDisabled) return
    videoRef.current?.pause()
    event.currentTarget.setPointerCapture(event.pointerId)
    currentStrokeRef.current = {
      id: crypto.randomUUID(),
      tool,
      size: brushPercent / 100,
      points: [pointFromEvent(event)],
    }
    paintMask()
    renderScene()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!currentStrokeRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    currentStrokeRef.current = appendStrokePoint(currentStrokeRef.current, pointFromEvent(event))
    paintMask()
    renderScene()
  }

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = currentStrokeRef.current
    if (!stroke) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    currentStrokeRef.current = null
    onCommitStroke(stroke)
  }

  const togglePlayback = () => {
    if (editingDisabled) return
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch((error: unknown) => setStageError(error instanceof Error ? error.message : '影片無法播放'))
    } else {
      video.pause()
    }
  }

  const canvasStyle = useMemo(() => ({
    aspectRatio: metadata ? `${metadata.width} / ${metadata.height}` : '16 / 9',
    cursor: editingDisabled ? 'not-allowed' : tool === 'keep' ? 'crosshair' : 'cell',
  }), [editingDisabled, metadata, tool])

  if (!videoUrl) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center bg-[#09090b] p-10">
        <div className="max-w-md text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-dashed border-cyan-400/30 bg-cyan-400/5 text-3xl text-cyan-300">＋</div>
          <h2 className="mt-6 text-xl font-medium text-stone-100">上傳一段實拍影片開始</h2>
          <p className="mt-3 text-sm leading-6 text-stone-500">第一版支援人物保留遮罩、背景圖片替換、逐幀檢查，以及原始解析度遮罩輸出。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#09090b]">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5">
        <video
          ref={videoRef}
          src={videoUrl}
          className="pointer-events-none absolute h-px w-px opacity-0"
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            setStageError(null)
            onMetadata({ width: video.videoWidth, height: video.videoHeight, duration: video.duration, name: videoName ?? 'video' })
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            const time = event.currentTarget.currentTime
            setCurrentTime(time)
            onTimeChange(time)
          }}
          onSeeked={() => {
            if (shouldRenderPreview(Boolean(recordingSessionRef.current))) renderScene()
          }}
          onError={() => setStageError('影片格式無法由瀏覽器解碼')}
        />
        <canvas
          ref={displayCanvasRef}
          aria-label="影片遮罩編輯畫布"
          className="max-h-full max-w-full touch-none rounded-lg border border-white/10 bg-black shadow-2xl"
          style={canvasStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        />
        <canvas ref={maskCanvasRef} className="hidden" aria-hidden="true" />
        {stageError ? <div role="alert" className="absolute bottom-5 rounded-lg border border-red-400/30 bg-red-950/90 px-4 py-2 text-sm text-red-200">{stageError}</div> : null}
      </div>

      <div className="flex items-center gap-3 border-t border-white/10 bg-stone-950 px-5 py-3">
        <button type="button" disabled={editingDisabled} onClick={togglePlayback} aria-label={playing ? '暫停影片' : '播放影片'} className="grid h-9 w-9 place-items-center rounded-full bg-white text-stone-950 hover:bg-cyan-200 disabled:opacity-40">
          {playing ? <AppIcon name="pause" className="h-4 w-4 fill-current" /> : <AppIcon name="play" className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <span className="w-12 font-mono text-xs text-stone-400">{currentTime.toFixed(1)}s</span>
        <input
          aria-label="影片時間"
          type="range"
          min={0}
          max={metadata?.duration ?? 0}
          step={0.01}
          value={Math.min(currentTime, metadata?.duration ?? 0)}
          disabled={editingDisabled}
          onChange={(event) => {
            const time = Number(event.target.value)
            setCurrentTime(time)
            onTimeChange(time)
            if (videoRef.current) videoRef.current.currentTime = time
          }}
          className="min-w-0 flex-1 accent-cyan-400"
        />
        <span className="w-14 text-right font-mono text-xs text-stone-500">{(metadata?.duration ?? 0).toFixed(1)}s</span>
      </div>
    </div>
  )
})
