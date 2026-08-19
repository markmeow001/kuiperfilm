'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { segmentObjectAtPoint } from './lib/interactive-segmenter'
import { paintMaskCanvas } from './lib/mask-canvas'
import { canvasBlob, drawCover, seekVideoForAnalysis } from './lib/mask-stage-utils'
import { resolveMaskFrame } from './lib/mask-keyframes'
import { appendStrokePoint, pointerToNormalizedPoint } from './lib/mask-strokes'
import { segmentPersonFrame } from './lib/person-segmenter'
import { cleanMaskWithDepth } from './lib/depth-engine'
import type { DepthGateOutcome } from './lib/depth-gate'
import { scanPersonMasksRvm, segmentPersonFrameRvm, type RvmScanFrame, type RvmScanProgress } from './lib/rvm-engine'
import { shouldRenderPreview } from './lib/render-ownership'
import { useVirtualCharacterMedia } from './useVirtualCharacterMedia'
import { sampleVideoAppearance } from './lib/character-appearance'
import { detectPoseAt } from './lib/pose-landmarker'
import { detectFaceAt, type FaceFrameAnalysis } from './lib/face-landmarker'
import {
  releaseCompositeRecordingAudio,
  startCompositeRecording,
  type CompositeRecordingProgress,
  type CompositeRecordingResult,
  type CompositeRecordingSession,
} from './lib/composite-video-recorder'
import {
  startDepthGuideRecording,
  type DepthGuideProgress,
  type DepthGuideRecordingResult,
  type DepthGuideRecordingSession,
} from './lib/depth-guide-recorder'
import type { CompositeView, MaskEditTarget, MaskKeyframe, MaskRaster, MaskStroke, MaskTool, NormalizedPoint, VideoMetadata, VirtualCharacterAppearance, VirtualCharacterLayer, VirtualCharacterMotionKeyframe } from './live-composite-types'
import styles from './LiveCompositeShell.module.css'

export interface MaskStageHandle {
  exportMask: () => Promise<Blob>
  exportCompositeFrame: () => Promise<Blob>
  exportCompositeVideo: (options: {
    includeAudio: boolean
    onProgress: (progress: CompositeRecordingProgress) => void
  }) => Promise<CompositeRecordingResult>
  exportDepthGuideVideo: (options: {
    includeAudio: boolean
    onProgress: (progress: DepthGuideProgress) => void
  }) => Promise<DepthGuideRecordingResult>
  cancelCompositeVideo: () => void
  cancelDepthGuideVideo: () => void
  seekTo: (time: number) => void
  analyzePersonAt: (time: number, threshold: number, edgeSoftness: number, depthCleanup: boolean) => Promise<{ mask: MaskRaster; depthOutcome: DepthGateOutcome }>
  /** Single-frame RVM matte; returns the active execution-provider label for the UI. */
  analyzeRvmPersonAt: (time: number, threshold: number, edgeSoftness: number, depthCleanup: boolean) => Promise<{ mask: MaskRaster; epLabel: string; depthOutcome: DepthGateOutcome }>
  /** Sequential RVM scan over the whole clip, committing keyframes at commitTimes. */
  analyzeRvmClip: (options: {
    commitTimes: number[]
    threshold: number
    edgeSoftness: number
    depthCleanup: boolean
    shouldContinue: () => boolean
    onProgress: (progress: RvmScanProgress) => void
  }) => Promise<RvmScanFrame[]>
  analyzeOccluderAt: (time: number, point: NormalizedPoint) => Promise<MaskRaster>
  matchCharacterAppearance: () => Partial<VirtualCharacterAppearance>
  analyzePoseAt: (time: number) => Promise<VirtualCharacterMotionKeyframe>
  /** null = no face at this time (漏檢 is track data, not an error). */
  analyzeFaceAt: (time: number) => Promise<FaceFrameAnalysis | null>
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
  occlusionKeyframes: MaskKeyframe[]
  occlusionBaseMask?: MaskRaster
  occlusionStrokes: MaskStroke[]
  editTarget: MaskEditTarget
  objectPickEnabled: boolean
  tool: MaskTool
  brushPercent: number
  view: CompositeView
  overlayVisible: boolean
  virtualCharacter: VirtualCharacterLayer | null
  editingDisabled?: boolean
  maskEditingEnabled?: boolean
  onMetadata: (metadata: VideoMetadata) => void
  onCommitStroke: (target: MaskEditTarget, stroke: MaskStroke) => void
  onPickOccluder: (point: NormalizedPoint) => void
  onTimeChange: (time: number) => void
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
  occlusionKeyframes,
  occlusionBaseMask,
  occlusionStrokes,
  editTarget,
  objectPickEnabled,
  tool,
  brushPercent,
  view,
  overlayVisible,
  virtualCharacter,
  editingDisabled = false,
  maskEditingEnabled = true,
  onMetadata,
  onCommitStroke,
  onPickOccluder,
  onTimeChange,
}: MaskStageProps, ref) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const occlusionCanvasRef = useRef<HTMLCanvasElement>(null)
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const backgroundImageRef = useRef<HTMLImageElement | null>(null)
  const renderSceneRef = useRef<() => void>(() => undefined)
  const currentStrokeRef = useRef<MaskStroke | null>(null)
  const recordingSessionRef = useRef<CompositeRecordingSession | null>(null)
  const depthGuideSessionRef = useRef<DepthGuideRecordingSession | null>(null)
  const analysisAbortRef = useRef<AbortController | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [stageError, setStageError] = useState<string | null>(null)
  const requestStageRender = useCallback(() => {
    if (shouldRenderPreview(Boolean(recordingSessionRef.current))) renderSceneRef.current()
  }, [])
  const {
    element: characterMediaElement,
    draw: drawVirtualCharacter,
    assertReady: assertCharacterMediaReady,
  } = useVirtualCharacterMedia({
    layer: virtualCharacter,
    keyframes,
    playing,
    timelineTime: currentTime,
    requestRender: requestStageRender,
    onError: setStageError,
  })
  const paintMask = useCallback((
    activeStroke: MaskStroke | null = currentStrokeRef.current,
    baseStrokes: MaskStroke[] = strokes,
    raster: MaskRaster | undefined = baseMask,
  ) => {
    paintMaskCanvas(maskCanvasRef.current, baseStrokes, raster, activeStroke)
  }, [baseMask, strokes])
  const paintOcclusionMask = useCallback((
    activeStroke: MaskStroke | null = editTarget === 'occlusion' ? currentStrokeRef.current : null,
    baseStrokes: MaskStroke[] = occlusionStrokes,
    raster: MaskRaster | undefined = occlusionBaseMask,
  ) => {
    paintMaskCanvas(occlusionCanvasRef.current, baseStrokes, raster, activeStroke)
  }, [editTarget, occlusionBaseMask, occlusionStrokes])
  const renderScene = useCallback((
    viewOverride?: CompositeView,
    showOverlay: boolean = overlayVisible,
    characterMask: MaskRaster | undefined = baseMask,
  ) => {
    const video = videoRef.current
    const display = displayCanvasRef.current
    const mask = maskCanvasRef.current
    const occlusionMask = occlusionCanvasRef.current
    const work = workCanvasRef.current
    if (!video || !display || !mask || !occlusionMask || !work || video.readyState < 2) return
    const context = display.getContext('2d')
    const workContext = work.getContext('2d')
    if (!context || !workContext) return

    const activeView = viewOverride ?? view
    const { width, height } = display
    context.clearRect(0, 0, width, height)

    if (activeView === 'mask') {
      context.fillStyle = '#000000'
      context.fillRect(0, 0, width, height)
      context.drawImage(editTarget === 'occlusion' ? occlusionMask : mask, 0, 0)
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
      const timelineTime = video.currentTime
      if (virtualCharacter?.depth === 'behind-person') drawVirtualCharacter(context, characterMask, timelineTime)
      workContext.clearRect(0, 0, width, height)
      workContext.globalCompositeOperation = 'source-over'
      workContext.drawImage(video, 0, 0, width, height)
      workContext.globalCompositeOperation = 'destination-in'
      workContext.drawImage(mask, 0, 0)
      workContext.globalCompositeOperation = 'source-over'
      context.drawImage(work, 0, 0)
      if (virtualCharacter?.depth === 'in-front') drawVirtualCharacter(context, characterMask, timelineTime)
      if (virtualCharacter) {
        workContext.clearRect(0, 0, width, height)
        workContext.globalCompositeOperation = 'source-over'
        workContext.drawImage(video, 0, 0, width, height)
        workContext.globalCompositeOperation = 'destination-in'
        workContext.drawImage(occlusionMask, 0, 0)
        workContext.globalCompositeOperation = 'source-over'
        context.drawImage(work, 0, 0)
      }
    }

    if (showOverlay) {
      workContext.clearRect(0, 0, width, height)
      workContext.globalCompositeOperation = 'source-over'
      workContext.drawImage(editTarget === 'occlusion' ? occlusionMask : mask, 0, 0)
      workContext.globalCompositeOperation = 'source-in'
      workContext.fillStyle = editTarget === 'occlusion' ? '#f59e0b' : '#fb4b6b'
      workContext.fillRect(0, 0, width, height)
      workContext.globalCompositeOperation = 'source-over'
      context.save()
      context.globalAlpha = 0.36
      context.drawImage(work, 0, 0)
      context.restore()
    }
  }, [backgroundColor, baseMask, drawVirtualCharacter, editTarget, overlayVisible, view, virtualCharacter])
  useEffect(() => {
    renderSceneRef.current = () => renderScene()
  }, [renderScene])
  useEffect(() => {
    if (!metadata) return
    const display = displayCanvasRef.current
    const mask = maskCanvasRef.current
    const occlusionMask = occlusionCanvasRef.current
    if (!display || !mask || !occlusionMask) return
    display.width = metadata.width
    display.height = metadata.height
    mask.width = metadata.width
    mask.height = metadata.height
    occlusionMask.width = metadata.width
    occlusionMask.height = metadata.height
    const work = document.createElement('canvas')
    work.width = metadata.width
    work.height = metadata.height
    workCanvasRef.current = work
  }, [metadata])
  useEffect(() => {
    if (!shouldRenderPreview(Boolean(recordingSessionRef.current))) return
    paintMask(null)
    paintOcclusionMask(null)
    renderScene()
  }, [metadata, paintMask, paintOcclusionMask, renderScene])

  useEffect(() => {
    backgroundImageRef.current = null
    if (!backgroundUrl) {
      if (shouldRenderPreview(Boolean(recordingSessionRef.current))) renderSceneRef.current()
      return
    }
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      backgroundImageRef.current = image
      if (shouldRenderPreview(Boolean(recordingSessionRef.current))) renderSceneRef.current()
    }
    image.onerror = () => setStageError('背景圖片無法讀取')
    image.src = backgroundUrl
    return () => {
      image.onload = null
      image.onerror = null
    }
  }, [backgroundUrl])
  useEffect(() => {
    if (!shouldRenderPreview(Boolean(recordingSessionRef.current))) return
    if (!playing) {
      const pausedTime = videoRef.current?.currentTime ?? 0
      const pausedKeyframe = resolveMaskFrame(keyframes, pausedTime)
      const pausedOcclusion = resolveMaskFrame(occlusionKeyframes, pausedTime)
      paintMask(null, pausedKeyframe?.strokes ?? [], pausedKeyframe?.baseMask)
      paintOcclusionMask(null, pausedOcclusion?.strokes ?? [], pausedOcclusion?.baseMask)
      renderScene(undefined, overlayVisible, pausedKeyframe?.baseMask)
      return
    }
    let animationFrame = 0
    const tick = () => {
      if (!shouldRenderPreview(Boolean(recordingSessionRef.current))) return
      const playbackTime = videoRef.current?.currentTime ?? 0
      const keyframe = resolveMaskFrame(keyframes, playbackTime)
      const occlusionKeyframe = resolveMaskFrame(occlusionKeyframes, playbackTime)
      paintMask(null, keyframe?.strokes ?? [], keyframe?.baseMask)
      paintOcclusionMask(null, occlusionKeyframe?.strokes ?? [], occlusionKeyframe?.baseMask)
      renderScene(undefined, overlayVisible, keyframe?.baseMask)
      animationFrame = window.requestAnimationFrame(tick)
    }
    animationFrame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [keyframes, occlusionKeyframes, overlayVisible, paintMask, paintOcclusionMask, playing, renderScene])

  useEffect(() => () => {
    analysisAbortRef.current?.abort()
    const depthGuideSession = depthGuideSessionRef.current
    depthGuideSession?.cancel()
    const recordingSession = recordingSessionRef.current
    recordingSession?.cancel()
    const video = videoRef.current
    if (!video) return
    if (depthGuideSession) {
      void depthGuideSession.result
        .catch(() => undefined)
        .finally(() => releaseCompositeRecordingAudio(video))
      return
    }
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
      const mask = editTarget === 'occlusion' ? occlusionCanvasRef.current : maskCanvasRef.current
      if (!mask || !metadata) throw new Error('請先載入影片並建立遮罩')
      const time = videoRef.current?.currentTime ?? 0
      const frame = resolveMaskFrame(editTarget === 'occlusion' ? occlusionKeyframes : keyframes, time)
      if (editTarget === 'occlusion') paintOcclusionMask(null, frame?.strokes ?? [], frame?.baseMask)
      else paintMask(null, frame?.strokes ?? [], frame?.baseMask)
      return canvasBlob(mask)
    },
    exportCompositeFrame: async () => {
      const display = displayCanvasRef.current
      if (!display || !metadata) throw new Error('請先載入影片')
      const time = videoRef.current?.currentTime ?? 0
      const frame = resolveMaskFrame(keyframes, time)
      const occlusionFrame = resolveMaskFrame(occlusionKeyframes, time)
      paintMask(null, frame?.strokes ?? [], frame?.baseMask)
      paintOcclusionMask(null, occlusionFrame?.strokes ?? [], occlusionFrame?.baseMask)
      renderScene('composite', false, frame?.baseMask)
      const blob = await canvasBlob(display)
      renderScene()
      return blob
    },
    exportCompositeVideo: async ({ includeAudio, onProgress }) => {
      const video = videoRef.current
      const display = displayCanvasRef.current
      if (!video || !display || !metadata) throw new Error('請先載入影片')
      if (backgroundUrl && !backgroundImageRef.current) throw new Error('背景圖片仍在載入，請稍後再輸出')
      assertCharacterMediaReady()
      if (recordingSessionRef.current) throw new Error('目前已有影片正在輸出')

      const session = startCompositeRecording({
        canvas: display,
        video,
        duration: metadata.duration,
        includeAudio,
        onProgress,
        onFrame: (time) => {
          const keyframe = resolveMaskFrame(keyframes, time)
          const occlusionKeyframe = resolveMaskFrame(occlusionKeyframes, time)
          paintMask(null, keyframe?.strokes ?? [], keyframe?.baseMask)
          paintOcclusionMask(null, occlusionKeyframe?.strokes ?? [], occlusionKeyframe?.baseMask)
          renderScene('composite', false, keyframe?.baseMask)
        },
        onRestore: () => {
          const keyframe = resolveMaskFrame(keyframes, video.currentTime)
          const occlusionKeyframe = resolveMaskFrame(occlusionKeyframes, video.currentTime)
          paintMask(null, keyframe?.strokes ?? [], keyframe?.baseMask)
          paintOcclusionMask(null, occlusionKeyframe?.strokes ?? [], occlusionKeyframe?.baseMask)
          renderScene(undefined, overlayVisible, keyframe?.baseMask)
        },
      })
      recordingSessionRef.current = session
      try {
        return await session.result
      } finally {
        if (recordingSessionRef.current === session) recordingSessionRef.current = null
      }
    },
    exportDepthGuideVideo: async ({ includeAudio, onProgress }) => {
      const video = videoRef.current
      if (!video || !metadata) throw new Error('請先載入影片')
      if (recordingSessionRef.current || depthGuideSessionRef.current) {
        throw new Error('目前已有影片正在處理')
      }
      const session = startDepthGuideRecording({
        video,
        duration: metadata.duration,
        includeAudio,
        onProgress,
      })
      depthGuideSessionRef.current = session
      try {
        return await session.result
      } finally {
        if (depthGuideSessionRef.current === session) depthGuideSessionRef.current = null
        renderScene()
      }
    },
    cancelCompositeVideo: () => recordingSessionRef.current?.cancel(),
    cancelDepthGuideVideo: () => depthGuideSessionRef.current?.cancel(),
    seekTo: (time: number) => {
      const video = videoRef.current
      if (!video) return
      video.pause()
      video.currentTime = time
      setCurrentTime(time)
      onTimeChange(time)
    },
    analyzePersonAt: async (time: number, threshold: number, edgeSoftness: number, depthCleanup: boolean) => {
      const video = videoRef.current
      if (!video || !metadata) throw new Error('請先載入可分析的影片')
      analysisAbortRef.current ??= new AbortController()
      video.pause()
      await seekVideoForAnalysis(video, Math.min(metadata.duration, Math.max(0, time)), analysisAbortRef.current.signal)
      const mask = await segmentPersonFrame(video, threshold, edgeSoftness)
      if (!depthCleanup) return { mask, depthOutcome: 'off' as const }
      // Keyframe-commit-time depth gating: the video still presents `time`.
      const gated = await cleanMaskWithDepth(video, mask)
      return { mask: gated.mask, depthOutcome: gated.outcome }
    },
    analyzeRvmPersonAt: async (time: number, threshold: number, edgeSoftness: number, depthCleanup: boolean) => {
      const video = videoRef.current
      if (!video || !metadata) throw new Error('請先載入可分析的影片')
      analysisAbortRef.current ??= new AbortController()
      video.pause()
      await seekVideoForAnalysis(video, Math.min(metadata.duration, Math.max(0, time)), analysisAbortRef.current.signal)
      const { mask, epLabel } = await segmentPersonFrameRvm(video, threshold, edgeSoftness)
      if (!depthCleanup) return { mask, epLabel, depthOutcome: 'off' as const }
      const gated = await cleanMaskWithDepth(video, mask)
      return { mask: gated.mask, epLabel, depthOutcome: gated.outcome }
    },
    analyzeRvmClip: async ({ depthCleanup, ...options }) => {
      const video = videoRef.current
      if (!video || !metadata) throw new Error('請先載入可分析的影片')
      analysisAbortRef.current ??= new AbortController()
      return scanPersonMasksRvm(video, {
        ...options,
        duration: metadata.duration,
        signal: analysisAbortRef.current.signal,
        // Runs at keyframe commit only, while the scan loop has the video
        // presented on the committed frame.
        gateMask: depthCleanup ? (mask) => cleanMaskWithDepth(video, mask) : undefined,
      })
    },
    analyzeOccluderAt: async (time: number, point: NormalizedPoint) => {
      const video = videoRef.current
      if (!video || !metadata) throw new Error('請先載入可分析的影片')
      video.pause()
      analysisAbortRef.current ??= new AbortController()
      await seekVideoForAnalysis(video, Math.min(metadata.duration, Math.max(0, time)), analysisAbortRef.current.signal)
      return segmentObjectAtPoint(video, point)
    },
    matchCharacterAppearance: () => videoRef.current ? sampleVideoAppearance(videoRef.current) : (() => { throw new Error('請先載入影片') })(),
    analyzePoseAt: (time: number) => detectPoseAt(videoRef.current, metadata?.duration, time, (analysisAbortRef.current ??= new AbortController()).signal),
    analyzeFaceAt: (time: number) => detectFaceAt(videoRef.current, metadata?.duration, time, (analysisAbortRef.current ??= new AbortController()).signal),
  }), [assertCharacterMediaReady, backgroundUrl, editTarget, keyframes, metadata, occlusionKeyframes, onTimeChange, overlayVisible, paintMask, paintOcclusionMask, renderScene])
  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return pointerToNormalizedPoint(event.clientX, event.clientY, rect)
  }
  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!metadata || editingDisabled || !maskEditingEnabled) return
    videoRef.current?.pause()
    const point = pointFromEvent(event)
    if (objectPickEnabled) {
      onPickOccluder(point)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    currentStrokeRef.current = {
      id: crypto.randomUUID(),
      tool,
      size: brushPercent / 100,
      points: [point],
    }
    if (editTarget === 'occlusion') paintOcclusionMask()
    else paintMask()
    renderScene()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!currentStrokeRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    currentStrokeRef.current = appendStrokePoint(currentStrokeRef.current, pointFromEvent(event))
    if (editTarget === 'occlusion') paintOcclusionMask()
    else paintMask()
    renderScene()
  }

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = currentStrokeRef.current
    if (!stroke) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    currentStrokeRef.current = null
    onCommitStroke(editTarget, stroke)
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
    cursor: editingDisabled ? 'not-allowed' : !maskEditingEnabled ? 'default' : objectPickEnabled ? 'copy' : tool === 'keep' ? 'crosshair' : 'cell',
  }), [editingDisabled, maskEditingEnabled, metadata, objectPickEnabled, tool])

  if (!videoUrl) {
    return (
      <div className={styles.stageEmpty}>
        <div className="max-w-md text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-dashed border-cyan-400/30 bg-cyan-400/5 text-3xl text-cyan-300">＋</div>
          <h2 className="mt-6 text-xl font-medium text-stone-100">從左側上傳一段實拍影片</h2>
          <p className="mt-3 text-sm leading-6 text-stone-500">可以用深度影片重建角色與場景，或切換到進階遮罩，保留原演員像素做傳統合成。</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.stageSurface}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5">
        <video
          ref={videoRef}
          src={videoUrl}
          className="pointer-events-none absolute h-px w-px opacity-0"
          playsInline
          crossOrigin="anonymous"
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
        {characterMediaElement}
        <canvas
          ref={displayCanvasRef}
          aria-label={maskEditingEnabled ? '影片遮罩編輯畫布' : '實拍影片預覽畫布'}
          className="max-h-full max-w-full touch-none rounded-lg border border-white/10 bg-black shadow-2xl"
          style={canvasStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        />
        <canvas ref={maskCanvasRef} className="hidden" aria-hidden="true" />
        <canvas ref={occlusionCanvasRef} className="hidden" aria-hidden="true" />
        {stageError ? <div role="alert" className="absolute bottom-5 rounded-lg border border-red-400/30 bg-red-950/90 px-4 py-2 text-sm text-red-200">{stageError}</div> : null}
      </div>

      <div className={styles.playbackControls} data-live-composite-playback>
        <button type="button" disabled={editingDisabled} onClick={togglePlayback} aria-label={playing ? '暫停影片' : '播放影片'} className={styles.playbackButton}>
          {playing ? <AppIcon name="pause" className="h-4 w-4 fill-current" /> : <AppIcon name="play" className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <span className="w-12 font-mono text-xs text-stone-400">{currentTime.toFixed(1)}s</span>
        <label
          className={`${styles.specialControlHitArea} flex min-w-0 flex-1 items-center`}
          data-live-composite-control-hit-area
        >
          <span className="sr-only">影片時間</span>
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
            className="w-full accent-cyan-400"
          />
        </label>
        <span className="w-14 text-right font-mono text-xs text-stone-500">{(metadata?.duration ?? 0).toFixed(1)}s</span>
      </div>
    </div>
  )
})
