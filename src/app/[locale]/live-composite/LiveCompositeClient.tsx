'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AppIcon } from '@/components/ui/icons'
import type { AiMaskSettings } from './AiMaskPanel'
import { CompositeAssetPanel } from './CompositeAssetPanel'
import { CompositeToolbar } from './CompositeToolbar'
import { MaskKeyframeRail } from './MaskKeyframeRail'
import { MaskStage, type MaskStageHandle } from './MaskStage'
import { buildMaskAnalysisTimes } from './lib/mask-analysis'
import { CompositeRecordingCancelledError } from './lib/composite-video-recorder'
import { releasePersonSegmenters } from './lib/person-segmenter'
import { releaseDepthSession } from './lib/depth-engine'
import { formatDepthCleanupSummary, type DepthGateOutcome } from './lib/depth-gate'
import { releaseRvmSession, RvmScanCancelledError } from './lib/rvm-engine'
import { releaseInteractiveSegmenter } from './lib/interactive-segmenter'
import { DEFAULT_CHARACTER_APPEARANCE } from './lib/character-appearance'
import { releasePoseLandmarker } from './lib/pose-landmarker'
import { releaseFaceLandmarker } from './lib/face-landmarker'
import { probeVideoHasAudio } from './lib/video-audio-probe'
import {
  extractFacePerformance,
  FACE_ANALYSIS_DEFAULT_INTERVAL,
  FacePerformanceCancelledError,
  type FacePerformanceTrack,
} from './lib/face-performance'
import { ProjectPanel } from './ProjectPanel'
import { SaveToLibraryDialog, type ExportedAsset } from './SaveToLibraryDialog'
import { useLiveCompositeProjects } from './useLiveCompositeProjects'
import { useMaskTimeline } from './useMaskTimeline'
import type { CompositeExportProgress, CompositeView, MaskAnalysisProgress, MaskEditTarget, MaskRaster, MaskTool, NormalizedPoint, VideoMetadata, VirtualCharacterLayer } from './live-composite-types'
import type { LiveCompositeWorkflowStep } from './LiveCompositeWorkflowGuide'

interface LiveCompositeClientProps {
  locale: string
}

const INITIAL_ANALYSIS_PROGRESS: MaskAnalysisProgress = {
  status: 'idle',
  completed: 0,
  total: 0,
  message: '',
}

const INITIAL_EXPORT_PROGRESS: CompositeExportProgress = {
  status: 'idle',
  currentTime: 0,
  duration: 0,
  message: '',
}

interface LastExport {
  asset: ExportedAsset
  label: string
}

/** 掃描完成訊息的深度淨化彙總（未啟用時回空字串）。 */
function depthCleanupSummary(enabled: boolean, outcomes: DepthGateOutcome[]): string {
  if (!enabled) return ''
  const applied = outcomes.filter((outcome) => outcome === 'applied').length
  const unreliable = outcomes.filter((outcome) => outcome === 'unreliable').length
  return `${formatDepthCleanupSummary(applied, outcomes.length, unreliable)}。`
}

function exportDefaultName(kind: string): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${kind} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function LiveCompositeClient({ locale }: LiveCompositeClientProps) {
  const searchParams = useSearchParams()
  const sourceRunId = searchParams?.get('sourceRunId')?.trim() || null
  const stageRef = useRef<MaskStageHandle>(null)
  const analysisRunRef = useRef(0)
  const analysisRestoreTimeRef = useRef<number | null>(null)
  const faceRunRef = useRef(0)
  const faceRestoreTimeRef = useRef<number | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoKey, setVideoKey] = useState<string | null>(null)
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  const [backgroundKey, setBackgroundKey] = useState<string | null>(null)
  const [backgroundColor, setBackgroundColor] = useState('#172033')
  const [virtualCharacter, setVirtualCharacter] = useState<VirtualCharacterLayer | null>(null)
  const [virtualCharacterFile, setVirtualCharacterFile] = useState<File | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('未命名合成')
  const [lastExport, setLastExport] = useState<LastExport | null>(null)
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false)
  const projectStore = useLiveCompositeProjects()
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const maskTimeline = useMaskTimeline(currentTime)
  const occlusionTimeline = useMaskTimeline(currentTime)
  const [editTarget, setEditTarget] = useState<MaskEditTarget>('person')
  const [occlusionPicking, setOcclusionPicking] = useState(false)
  const [occlusionBusy, setOcclusionBusy] = useState(false)
  const [occlusionMessage, setOcclusionMessage] = useState<string | null>(null)
  const [motionBusy, setMotionBusy] = useState(false)
  const [motionMessage, setMotionMessage] = useState<string | null>(null)
  const [tool, setTool] = useState<MaskTool>('keep')
  const [view, setView] = useState<CompositeView>('source')
  const [brushPercent, setBrushPercent] = useState(6)
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [workflowStep, setWorkflowStep] = useState<LiveCompositeWorkflowStep>(1)
  const [exportError, setExportError] = useState<string | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState<MaskAnalysisProgress>(INITIAL_ANALYSIS_PROGRESS)
  const [faceProgress, setFaceProgress] = useState<MaskAnalysisProgress>(INITIAL_ANALYSIS_PROGRESS)
  const [faceTrack, setFaceTrack] = useState<FacePerformanceTrack | null>(null)
  // null＝尚未偵測或瀏覽器無法偵測音訊軌；供表演素材體檢報告使用。
  const [videoHasAudio, setVideoHasAudio] = useState<boolean | null>(null)
  const [exportProgress, setExportProgress] = useState<CompositeExportProgress>(INITIAL_EXPORT_PROGRESS)
  const isVideoExporting = exportProgress.status === 'preparing' || exportProgress.status === 'recording'
  const isMaskAnalyzing = analysisProgress.status === 'loading-model' || analysisProgress.status === 'analyzing'
  const isFaceAnalyzing = faceProgress.status === 'loading-model' || faceProgress.status === 'analyzing'
  // Every existing "analysis running" gate also locks during face analysis.
  const isAnalyzing = isMaskAnalyzing || isFaceAnalyzing
  const canAnalyzeFace = Boolean(metadata) && !isVideoExporting && !isMaskAnalyzing && !occlusionBusy && !motionBusy

  useEffect(() => {
    if (!sourceRunId || videoUrl) return
    let cancelled = false
    void fetch(`/api/playground/runs/${encodeURIComponent(sourceRunId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          run?: { resultUrls?: string[] | null }
          error?: { message?: string }
        } | null
        if (!response.ok) throw new Error(payload?.error?.message ?? '無法載入 Playground 影片')
        const sourceUrl = payload?.run?.resultUrls?.[0]
        if (!sourceUrl) throw new Error('Playground 影片沒有可用結果')
        if (cancelled) return
        setVideoUrl(sourceUrl)
        setVideoName('Playground 實拍重建結果.mp4')
        setVideoFile(null)
        setVideoKey(sourceUrl)
        setWorkflowStep(2)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setExportError(caught instanceof Error ? caught.message : '無法載入 Playground 影片')
      })
    return () => { cancelled = true }
  }, [sourceRunId, videoUrl])

  useEffect(() => {
    setVideoHasAudio(null)
    if (!videoUrl) return
    let cancelled = false
    void probeVideoHasAudio(videoUrl)
      .then((result) => {
        if (!cancelled) setVideoHasAudio(result)
      })
      .catch(() => {
        // 偵測失敗＝無法確認，體檢報告以 unknown 列顯示。
        if (!cancelled) setVideoHasAudio(null)
      })
    return () => { cancelled = true }
  }, [videoUrl])

  useEffect(
    () => () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    },
    [videoUrl],
  )

  useEffect(
    () => () => {
      if (backgroundUrl) URL.revokeObjectURL(backgroundUrl)
    },
    [backgroundUrl],
  )

  useEffect(() => {
    const localUrl = virtualCharacterFile ? virtualCharacter?.assetUrl : null
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl)
    }
  }, [virtualCharacter?.assetUrl, virtualCharacterFile])

  useEffect(() => () => releasePoseLandmarker(), [])
  useEffect(() => () => releaseFaceLandmarker(), [])

  useEffect(
    () => () => {
      void releasePersonSegmenters()
      void releaseInteractiveSegmenter()
      void releaseRvmSession()
      void releaseDepthSession()
    },
    [],
  )

  const selectVideo = (file: File) => {
    // Swapping the video element's source while an analysis seek is pending
    // would leave that seek waiting forever, so uploads stay locked until the
    // user cancels the analysis or it completes.
    if (isVideoExporting || isAnalyzing || occlusionBusy) return
    analysisRunRef.current += 1
    faceRunRef.current += 1
    setVideoUrl(URL.createObjectURL(file))
    setVideoName(file.name)
    setVideoFile(file)
    setVideoKey(null)
    setMetadata(null)
    setCurrentTime(0)
    maskTimeline.reset()
    occlusionTimeline.reset()
    setEditTarget('person')
    setOcclusionPicking(false)
    setOcclusionMessage(null)
    setView('source')
    setExportError(null)
    setAnalysisProgress(INITIAL_ANALYSIS_PROGRESS)
    setFaceProgress(INITIAL_ANALYSIS_PROGRESS)
    setFaceTrack(null)
    setExportProgress(INITIAL_EXPORT_PROGRESS)
    setWorkflowStep(2)
  }

  const selectBackground = (file: File) => {
    if (isVideoExporting || isAnalyzing || occlusionBusy) return
    setBackgroundUrl(URL.createObjectURL(file))
    setBackgroundFile(file)
    setBackgroundKey(null)
    setView('composite')
    setWorkflowStep(4)
    setExportError(null)
  }

  const selectVirtualCharacter = (file: File) => {
    if (isVideoExporting || isAnalyzing || occlusionBusy || !metadata) return
    const assetType = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null
    if (!assetType) {
      setExportError('虛擬角色素材必須是圖片或影片格式。')
      return
    }
    setVirtualCharacter({
      assetType,
      assetName: file.name,
      assetUrl: URL.createObjectURL(file),
      assetKey: null,
      anchor: 'screen',
      x: 0.72,
      y: 0.58,
      offsetX: 0.28,
      offsetY: 0,
      scale: 0.42,
      rotation: 0,
      opacity: 1,
      startTime: 0,
      endTime: metadata.duration,
      loop: true,
      depth: 'behind-person',
    })
    setVirtualCharacterFile(file)
    setView('composite')
    setWorkflowStep(5)
    setOverlayVisible(false)
    setExportError(null)
  }

  const updateVirtualCharacter = (patch: Partial<VirtualCharacterLayer>) => {
    setVirtualCharacter((current) => {
      if (!current) return null
      const next = { ...current, ...patch }
      if ('startTime' in patch && next.startTime > next.endTime) next.endTime = next.startTime
      if ('endTime' in patch && next.endTime < next.startTime) next.startTime = next.endTime
      return next
    })
  }

  const analyzeCharacterMotion = async (wholeClip: boolean) => {
    const stage = stageRef.current
    if (!stage || !metadata || !virtualCharacter || motionBusy) return
    const restoreTime = currentTime
    const times = wholeClip ? buildMaskAnalysisTimes(metadata.duration, 0.5) : [currentTime]
    setMotionBusy(true)
    setMotionMessage(`正在分析骨架 0 / ${times.length}`)
    const detected = [] as NonNullable<VirtualCharacterLayer['motionKeyframes']>
    let firstFailure: unknown = null
    try {
      for (let index = 0; index < times.length; index += 1) {
        try {
          detected.push(await stage.analyzePoseAt(times[index]))
        } catch (error) {
          firstFailure ??= error
        }
        setMotionMessage(`正在分析骨架 ${index + 1} / ${times.length}`)
      }
      if (detected.length === 0) throw firstFailure instanceof Error ? firstFailure : new Error('這段畫面沒有偵測到完整人體骨架')
      const previous = wholeClip ? [] : (virtualCharacter.motionKeyframes ?? []).filter((keyframe) => Math.abs(keyframe.time - currentTime) >= 0.05)
      updateVirtualCharacter({
        motionEnabled: true,
        motionKeyframes: [...previous, ...detected].sort((a, b) => a.time - b.time),
      })
      setMotionMessage(`完成 ${detected.length} 個動作關鍵影格${detected.length < times.length ? `，${times.length - detected.length} 格未偵測到完整骨架` : ''}`)
    } catch (error) {
      setMotionMessage(error instanceof Error ? error.message : '骨架分析失敗')
    } finally {
      stage.seekTo(restoreTime)
      setMotionBusy(false)
    }
  }

  const saveProject = async () => {
    if (isVideoExporting || isAnalyzing || occlusionBusy) return
    try {
      const saved = await projectStore.saveProject({
        projectId,
        name: projectName,
        videoFile,
        videoKey,
        videoName,
        backgroundFile,
        backgroundKey,
        backgroundColor,
        keyframes: maskTimeline.keyframes,
        occlusionKeyframes: occlusionTimeline.keyframes,
        virtualCharacter,
        virtualCharacterFile,
        faceTrack,
      })
      setProjectId(saved.projectId)
      setVideoKey(saved.videoKey)
      setBackgroundKey(saved.backgroundKey)
      if (virtualCharacter && saved.virtualCharacterKey) {
        setVirtualCharacter({
          ...virtualCharacter,
          assetKey: saved.virtualCharacterKey,
        })
      }
    } catch {
      // Not silent: the hook already recorded the failure and ProjectPanel
      // renders projectStore.error to the user.
    }
  }

  const openProject = async (id: string) => {
    if (isVideoExporting || isAnalyzing || occlusionBusy) return
    try {
      const loaded = await projectStore.openProject(id)
      const loadedMaskReady = loaded.keyframes.some((keyframe) => Boolean(keyframe.baseMask))
      analysisRunRef.current += 1
      faceRunRef.current += 1
      setProjectId(loaded.id)
      setProjectName(loaded.name)
      setVideoFile(null)
      setVideoKey(loaded.videoKey)
      setVideoUrl(loaded.videoUrl)
      setVideoName(loaded.videoName)
      setBackgroundFile(null)
      setBackgroundKey(loaded.backgroundKey)
      setBackgroundUrl(loaded.backgroundUrl)
      setBackgroundColor(loaded.backgroundColor)
      setVirtualCharacterFile(null)
      setVirtualCharacter(loaded.virtualCharacter)
      setMetadata(null)
      setCurrentTime(0)
      maskTimeline.load(loaded.keyframes)
      occlusionTimeline.load(loaded.occlusionKeyframes)
      setEditTarget('person')
      setOcclusionPicking(false)
      setOcclusionMessage(null)
      setView(loaded.backgroundKey ? 'composite' : loadedMaskReady ? 'mask' : 'source')
      setExportError(null)
      setAnalysisProgress(INITIAL_ANALYSIS_PROGRESS)
      setFaceProgress(INITIAL_ANALYSIS_PROGRESS)
      setFaceTrack(loaded.faceTrack)
      setExportProgress(INITIAL_EXPORT_PROGRESS)
      setWorkflowStep(loaded.backgroundKey ? 4 : loadedMaskReady ? 3 : 2)
    } catch {
      // Not silent: surfaced through projectStore.error in ProjectPanel.
    }
  }

  const exportMask = async () => {
    try {
      setExportError(null)
      const blob = await stageRef.current?.exportMask()
      if (!blob) throw new Error('遮罩尚未準備完成')
      downloadBlob(blob, 'kuiper-mask.png')
      setLastExport({
        label: '遮罩 PNG',
        asset: {
          blob,
          assetType: 'image',
          mimeType: 'image/png',
          fileName: 'kuiper-mask.png',
          defaultName: exportDefaultName('遮罩'),
        },
      })
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '遮罩輸出失敗')
    }
  }

  const exportFrame = async () => {
    try {
      setExportError(null)
      const blob = await stageRef.current?.exportCompositeFrame()
      if (!blob) throw new Error('合成影格尚未準備完成')
      downloadBlob(blob, 'kuiper-composite-frame.png')
      setLastExport({
        label: '合成影格',
        asset: {
          blob,
          assetType: 'image',
          mimeType: 'image/png',
          fileName: 'kuiper-composite-frame.png',
          defaultName: exportDefaultName('合成影格'),
        },
      })
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '合成影格輸出失敗')
    }
  }

  const exportVideo = async (includeAudio: boolean) => {
    const stage = stageRef.current
    if (isVideoExporting) {
      // Keep the in-flight export's progress state intact; surface the reason
      // through the error banner instead of overwriting exportProgress.
      setExportError('已有影片輸出進行中，請先取消或等待完成。')
      return
    }
    if (isAnalyzing) {
      setExportProgress({
        status: 'failed',
        currentTime: 0,
        duration: metadata?.duration ?? 0,
        message: '分析進行中，請先取消或等待分析完成。',
      })
      return
    }
    if (!stage || !metadata) {
      setExportProgress({
        status: 'failed',
        currentTime: 0,
        duration: 0,
        message: '請先載入影片。',
      })
      return
    }

    setExportError(null)
    setExportProgress({
      status: 'preparing',
      currentTime: 0,
      duration: metadata.duration,
      message: '正在準備本機錄影器…',
    })
    try {
      const result = await stage.exportCompositeVideo({
        includeAudio,
        onProgress: ({ currentTime: exportTime, duration }) => {
          setExportProgress({
            status: 'recording',
            currentTime: exportTime,
            duration,
            message: '正在逐幀合成影片…',
          })
        },
      })
      const baseName = metadata.name.replace(/\.[^.]+$/, '') || 'kuiper-composite'
      downloadBlob(result.blob, `${baseName}-composite.${result.extension}`)
      setLastExport({
        label: '合成影片',
        asset: {
          blob: result.blob,
          assetType: 'video',
          mimeType: result.extension === 'mp4' ? 'video/mp4' : 'video/webm',
          fileName: `${baseName}-composite.${result.extension}`,
          defaultName: exportDefaultName('合成影片'),
        },
      })
      setExportProgress({
        status: 'completed',
        currentTime: metadata.duration,
        duration: metadata.duration,
        message: `合成影片已完成（${result.mimeType}）。`,
      })
      setWorkflowStep(6)
    } catch (error) {
      if (error instanceof CompositeRecordingCancelledError) {
        setExportProgress({
          status: 'idle',
          currentTime: 0,
          duration: metadata.duration,
          message: '影片輸出已取消。',
        })
        return
      }
      setExportProgress({
        status: 'failed',
        currentTime: 0,
        duration: metadata.duration,
        message: error instanceof Error ? error.message : '合成影片輸出失敗',
      })
    }
  }

  const cancelVideoExport = () => {
    stageRef.current?.cancelCompositeVideo()
  }

  const cancelAnalysis = () => {
    analysisRunRef.current += 1
    const restoreTime = analysisRestoreTimeRef.current
    analysisRestoreTimeRef.current = null
    if (restoreTime !== null) stageRef.current?.seekTo(restoreTime)
    setAnalysisProgress({
      status: 'idle',
      completed: 0,
      total: 0,
      message: '已取消；未套用未完成的分析結果。',
    })
  }

  const runPersonAnalysis = async (times: number[], settings: AiMaskSettings) => {
    const stage = stageRef.current
    if (!stage || !metadata) {
      setAnalysisProgress({
        status: 'failed',
        completed: 0,
        total: 0,
        message: '請先載入可分析的影片。',
      })
      return
    }

    const runId = analysisRunRef.current + 1
    analysisRunRef.current = runId
    const restoreTime = currentTime
    analysisRestoreTimeRef.current = restoreTime
    setAnalysisProgress({
      status: 'loading-model',
      completed: 0,
      total: times.length,
      message: '正在載入本機人物分割模型…',
    })

    try {
      const frames = []
      const depthOutcomes: DepthGateOutcome[] = []
      const depthLabel = settings.depthCleanup ? '＋深度' : ''
      for (let index = 0; index < times.length; index += 1) {
        if (analysisRunRef.current !== runId) return
        const time = times[index]
        setAnalysisProgress({
          status: 'analyzing',
          completed: index,
          total: times.length,
          message: `分析 ${time.toFixed(2)} 秒的人物輪廓${depthLabel}…`,
        })
        const { mask, depthOutcome } = await stage.analyzePersonAt(time, settings.threshold, settings.edgeSoftness, settings.depthCleanup)
        if (analysisRunRef.current !== runId) return
        frames.push({ time, mask })
        depthOutcomes.push(depthOutcome)
        setAnalysisProgress({
          status: 'analyzing',
          completed: index + 1,
          total: times.length,
          message: `已完成 ${index + 1} / ${times.length} 個分析影格`,
        })
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }

      maskTimeline.applyAiMasks(frames)
      setView('mask')
      setOverlayVisible(true)
      setAnalysisProgress({
        status: 'completed',
        completed: times.length,
        total: times.length,
        message: `AI 人物遮罩完成：已建立 ${times.length} 個可手動修正的關鍵影格。${depthCleanupSummary(settings.depthCleanup, depthOutcomes)}`,
      })
      setWorkflowStep(3)
    } catch (error) {
      if (analysisRunRef.current !== runId) return
      setAnalysisProgress({
        status: 'failed',
        completed: 0,
        total: times.length,
        message: error instanceof Error ? error.message : 'AI 人物遮罩分析失敗',
      })
    } finally {
      if (analysisRunRef.current === runId) {
        analysisRestoreTimeRef.current = null
        stage.seekTo(restoreTime)
      }
    }
  }

  // RVM engine: one sequential pass over EVERY frame, threading recurrent
  // state, committing keyframes only at the requested sampling times. Cancel
  // and restore-time wiring mirrors runPersonAnalysis (analysisRunRef).
  const runRvmAnalysis = async (wholeClip: boolean, settings: AiMaskSettings) => {
    const stage = stageRef.current
    if (!stage || !metadata) {
      setAnalysisProgress({
        status: 'failed',
        completed: 0,
        total: 0,
        message: '請先載入可分析的影片。',
      })
      return
    }

    let commitTimes: number[]
    try {
      commitTimes = wholeClip ? buildMaskAnalysisTimes(metadata.duration, settings.interval) : [currentTime]
    } catch (error) {
      setAnalysisProgress({
        status: 'failed',
        completed: 0,
        total: 0,
        message: error instanceof Error ? error.message : '無法建立影片分析範圍',
      })
      return
    }

    const runId = analysisRunRef.current + 1
    analysisRunRef.current = runId
    const restoreTime = currentTime
    analysisRestoreTimeRef.current = restoreTime
    setAnalysisProgress({
      status: 'loading-model',
      completed: 0,
      total: 0,
      message: '正在載入本機 RVM 模型…',
    })

    try {
      let frames: Array<{ time: number; mask: MaskRaster }>
      let depthOutcomes: DepthGateOutcome[]
      let epLabel = 'RVM'
      const depthLabel = settings.depthCleanup ? '＋深度' : ''
      if (wholeClip) {
        const scanned = await stage.analyzeRvmClip({
          commitTimes,
          threshold: settings.threshold,
          edgeSoftness: settings.edgeSoftness,
          depthCleanup: settings.depthCleanup,
          shouldContinue: () => analysisRunRef.current === runId,
          onProgress: (progress) => {
            epLabel = progress.epLabel
            setAnalysisProgress({
              status: 'analyzing',
              completed: progress.frameIndex,
              total: progress.frameCount,
              message: `${progress.epLabel}${depthLabel}｜已處理 ${progress.processedSeconds.toFixed(1)} / ${progress.totalSeconds.toFixed(1)} 秒`,
            })
          },
        })
        frames = scanned.map(({ time, mask }) => ({ time, mask }))
        depthOutcomes = scanned.map(({ depthOutcome }) => depthOutcome)
      } else {
        const result = await stage.analyzeRvmPersonAt(commitTimes[0], settings.threshold, settings.edgeSoftness, settings.depthCleanup)
        frames = [{ time: commitTimes[0], mask: result.mask }]
        depthOutcomes = [result.depthOutcome]
        epLabel = result.epLabel
      }
      if (analysisRunRef.current !== runId) return
      maskTimeline.applyAiMasks(frames)
      setView('mask')
      setOverlayVisible(true)
      setAnalysisProgress({
        status: 'completed',
        completed: frames.length,
        total: frames.length,
        message: `${epLabel}｜人物遮罩完成：已建立 ${frames.length} 個可手動修正的關鍵影格。${depthCleanupSummary(settings.depthCleanup, depthOutcomes)}`,
      })
      setWorkflowStep(3)
    } catch (error) {
      if (analysisRunRef.current !== runId) return
      // Cancellation already wrote its own idle message in cancelAnalysis.
      if (error instanceof RvmScanCancelledError) return
      setAnalysisProgress({
        status: 'failed',
        completed: 0,
        total: 0,
        message: error instanceof Error ? error.message : 'RVM 人物遮罩分析失敗',
      })
    } finally {
      if (analysisRunRef.current === runId) {
        analysisRestoreTimeRef.current = null
        stage.seekTo(restoreTime)
      }
    }
  }

  const cancelFaceAnalysis = () => {
    faceRunRef.current += 1
    const restoreTime = faceRestoreTimeRef.current
    faceRestoreTimeRef.current = null
    if (restoreTime !== null) stageRef.current?.seekTo(restoreTime)
    setFaceProgress({
      status: 'idle',
      completed: 0,
      total: 0,
      message: '已取消；未套用未完成的臉部分析結果。',
    })
  }

  const analyzeFacePerformance = async () => {
    const stage = stageRef.current
    if (!stage || !metadata) {
      setFaceProgress({
        status: 'failed',
        completed: 0,
        total: 0,
        message: '請先載入可分析的影片。',
      })
      return
    }
    let times: number[]
    try {
      times = buildMaskAnalysisTimes(metadata.duration, FACE_ANALYSIS_DEFAULT_INTERVAL)
    } catch (error) {
      setFaceProgress({
        status: 'failed',
        completed: 0,
        total: 0,
        message: error instanceof Error ? error.message : '無法建立臉部分析範圍',
      })
      return
    }
    const runId = faceRunRef.current + 1
    faceRunRef.current = runId
    const restoreTime = currentTime
    faceRestoreTimeRef.current = restoreTime
    setFaceProgress({
      status: 'loading-model',
      completed: 0,
      total: times.length,
      message: '正在載入本機臉部模型…',
    })
    try {
      const track = await extractFacePerformance(
        { analyzeFaceAt: (time) => stage.analyzeFaceAt(time) },
        times,
        {
          shouldContinue: () => faceRunRef.current === runId,
          onProgress: (completed, total) => {
            setFaceProgress({
              status: 'analyzing',
              completed,
              total,
              message: `已完成 ${completed} / ${total} 個臉部影格`,
            })
          },
        },
      )
      if (faceRunRef.current !== runId) return
      setFaceTrack(track)
      const detected = track.samples.filter((sample) => sample.faceBox !== null).length
      setFaceProgress({
        status: 'completed',
        completed: times.length,
        total: times.length,
        message: `臉部表演分析完成：偵測 ${detected} / ${times.length} 個影格${detected < times.length ? `，${times.length - detected} 格未偵測到臉部` : ''}。`,
      })
    } catch (error) {
      if (faceRunRef.current !== runId) return
      if (error instanceof FacePerformanceCancelledError) return
      setFaceProgress({
        status: 'failed',
        completed: 0,
        total: times.length,
        message: error instanceof Error ? error.message : '臉部表演分析失敗',
      })
    } finally {
      if (faceRunRef.current === runId) {
        faceRestoreTimeRef.current = null
        stage.seekTo(restoreTime)
      }
    }
  }

  const analyzeCurrent = (settings: AiMaskSettings) => {
    if (settings.engine === 'rvm') {
      void runRvmAnalysis(false, settings)
      return
    }
    void runPersonAnalysis([currentTime], settings)
  }

  const analyzeClip = (settings: AiMaskSettings) => {
    if (settings.engine === 'rvm') {
      void runRvmAnalysis(true, settings)
      return
    }
    try {
      if (!metadata) throw new Error('請先載入可分析的影片')
      void runPersonAnalysis(buildMaskAnalysisTimes(metadata.duration, settings.interval), settings)
    } catch (error) {
      setAnalysisProgress({
        status: 'failed',
        completed: 0,
        total: 0,
        message: error instanceof Error ? error.message : '無法建立影片分析範圍',
      })
    }
  }

  const startOcclusionPicking = () => {
    setEditTarget('occlusion')
    setView('composite')
    setOverlayVisible(true)
    setOcclusionPicking(true)
    setOcclusionMessage('點選畫面中的前景物件，AI 會建立目前時間的遮擋關鍵影格。')
  }

  const pickOccluder = async (point: NormalizedPoint) => {
    const stage = stageRef.current
    if (!stage || !metadata || occlusionBusy) return
    setOcclusionBusy(true)
    setOcclusionMessage('正在以本機 AI 辨識點選的物件…')
    try {
      const mask = await stage.analyzeOccluderAt(currentTime, point)
      occlusionTimeline.applyAiMasks([{ time: currentTime, mask }])
      setOcclusionPicking(false)
      setView('composite')
      setOverlayVisible(true)
      setOcclusionMessage('已建立前景遮擋；可用「增加遮擋／移除遮擋」筆刷修正邊緣。')
    } catch (error) {
      setOcclusionMessage(error instanceof Error ? error.message : '前景物件辨識失敗')
    } finally {
      setOcclusionBusy(false)
    }
  }

  const activeTimeline = editTarget === 'occlusion' ? occlusionTimeline : maskTimeline
  const maskReady = maskTimeline.keyframes.some((keyframe) => Boolean(keyframe.baseMask))
  const completedWorkflowSteps = new Set<LiveCompositeWorkflowStep>()
  if (metadata) completedWorkflowSteps.add(1)
  if (maskReady) completedWorkflowSteps.add(2)
  if (maskReady && workflowStep > 3) completedWorkflowSteps.add(3)
  if (backgroundUrl || workflowStep > 4) completedWorkflowSteps.add(4)
  if (virtualCharacter) completedWorkflowSteps.add(5)
  if (lastExport) completedWorkflowSteps.add(6)

  const changeWorkflowStep = (step: LiveCompositeWorkflowStep) => {
    setWorkflowStep(step)
    setOcclusionPicking(false)
    if (step === 1 || step === 2) setView('source')
    if (step === 3) {
      setEditTarget('person')
      setView('mask')
      setOverlayVisible(true)
    }
    if (step >= 4) {
      setView('composite')
      setOverlayVisible(false)
    }
  }

  return (
    <main className="kuiper-studio-page flex h-dvh min-h-[680px] flex-col overflow-hidden">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 overflow-x-auto border-b border-white/10 bg-[#0B0B0D]/95 px-4 py-2 sm:px-5">
        <div className="flex items-center gap-4">
          <Link href={`/${locale}/v2`} aria-label="回到專案列表" className="grid h-9 w-9 place-items-center rounded-lg text-stone-500 hover:bg-white/10 hover:text-white">
            <AppIcon name="arrowLeft" className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <AppIcon name="sparklesAlt" className="h-4 w-4 text-cyan-300" />
              AI 實拍重製
            </div>
            <div className="mt-0.5 text-xs text-stone-600">表演驅動角色重製 · 真人提供表演，AI 重新生成角色與場景</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-stone-500">
          <span>{metadata ? `已載入影片 · ${metadata.duration.toFixed(1)} 秒` : '尚未載入影片'}</span>
          <ProjectPanel projectName={projectName} hasProject={Boolean(projectId)} projects={projectStore.projects} busyMessage={projectStore.busyMessage} error={projectStore.error} disabled={isVideoExporting || isAnalyzing || occlusionBusy} onProjectNameChange={setProjectName} onSave={() => void saveProject()} onOpen={(id) => void openProject(id)} onRefreshList={() => void projectStore.refreshProjects()} />
        </div>
      </header>

      {metadata && workflowStep >= 3 ? (
        <CompositeToolbar
          tool={tool}
          editTarget={editTarget}
          view={view}
          brushPercent={brushPercent}
          overlayVisible={overlayVisible}
          canUndo={activeTimeline.canUndo}
          canRedo={activeTimeline.canRedo}
          currentTime={currentTime}
          disabled={isVideoExporting || occlusionBusy}
          onToolChange={(nextTool) => {
            setTool(nextTool)
            setView(editTarget === 'person' ? 'mask' : 'composite')
            setOverlayVisible(true)
          }}
          onEditTargetChange={(target) => {
            setEditTarget(target)
            setOcclusionPicking(false)
            setView(target === 'person' ? 'mask' : 'composite')
            setOverlayVisible(true)
          }}
          onViewChange={setView}
          onBrushPercentChange={setBrushPercent}
          onOverlayVisibleChange={setOverlayVisible}
          onUndo={activeTimeline.undo}
          onRedo={activeTimeline.redo}
          onClear={activeTimeline.clearCurrent}
        />
      ) : (
        <div className="border-b border-white/10 bg-stone-950/90 px-5 py-3 text-sm text-stone-400">{metadata ? '下一步：在左側執行 AI 人物辨識，完成後才會顯示修邊工具。' : '先從左側上傳一段實拍影片。'}</div>
      )}

      <div className="flex min-h-0 flex-1">
        <CompositeAssetPanel
          metadata={metadata}
          backgroundColor={backgroundColor}
          hasBackgroundImage={Boolean(backgroundUrl)}
          canExport={Boolean(metadata) && !isAnalyzing && !occlusionBusy}
          currentTime={currentTime}
          analysisProgress={analysisProgress}
          exportProgress={exportProgress}
          interactionDisabled={isVideoExporting || isAnalyzing || occlusionBusy}
          virtualCharacter={virtualCharacter}
          maskKeyframes={maskTimeline.keyframes}
          occlusionPicking={occlusionPicking}
          occlusionBusy={occlusionBusy}
          occlusionMessage={occlusionMessage}
          occlusionKeyframeCount={occlusionTimeline.keyframes.length}
          onVideoSelect={selectVideo}
          onBackgroundSelect={selectBackground}
          onBackgroundColorChange={setBackgroundColor}
          onVirtualCharacterSelect={selectVirtualCharacter}
          onVirtualCharacterChange={updateVirtualCharacter}
          onVirtualCharacterAutoMatch={() => {
            try {
              const patch = stageRef.current?.matchCharacterAppearance()
              if (patch)
                updateVirtualCharacter({
                  appearance: {
                    ...DEFAULT_CHARACTER_APPEARANCE,
                    ...virtualCharacter?.appearance,
                    ...patch,
                  },
                })
            } catch (error) {
              setExportError(error instanceof Error ? error.message : '畫面匹配失敗')
            }
          }}
          motionBusy={motionBusy}
          motionMessage={motionMessage}
          onAnalyzeMotionCurrent={() => void analyzeCharacterMotion(false)}
          onAnalyzeMotionClip={() => void analyzeCharacterMotion(true)}
          onVirtualCharacterRemove={() => {
            setVirtualCharacter(null)
            setVirtualCharacterFile(null)
          }}
          onStartOcclusionPicking={startOcclusionPicking}
          onCancelOcclusionPicking={() => setOcclusionPicking(false)}
          onExportMask={exportMask}
          onExportFrame={exportFrame}
          onExportVideo={(includeAudio) => void exportVideo(includeAudio)}
          onCancelVideoExport={cancelVideoExport}
          onAnalyzeCurrent={analyzeCurrent}
          onAnalyzeClip={analyzeClip}
          onCancelAnalysis={cancelAnalysis}
          canAnalyzeFace={canAnalyzeFace}
          faceProgress={faceProgress}
          faceTrack={faceTrack}
          videoHasAudio={videoHasAudio}
          onAnalyzeFace={() => void analyzeFacePerformance()}
          onCancelFaceAnalysis={cancelFaceAnalysis}
          onClearFaceTrack={() => {
            setFaceTrack(null)
            setFaceProgress(INITIAL_ANALYSIS_PROGRESS)
          }}
          lastExportLabel={lastExport?.label ?? null}
          onSaveToLibrary={lastExport ? () => setLibraryDialogOpen(true) : undefined}
          workflowStep={workflowStep}
          completedWorkflowSteps={completedWorkflowSteps}
          onWorkflowStepChange={changeWorkflowStep}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <MaskStage
            ref={stageRef}
            videoUrl={videoUrl}
            videoName={videoName}
            backgroundUrl={backgroundUrl}
            backgroundColor={backgroundColor}
            metadata={metadata}
            keyframes={maskTimeline.keyframes}
            baseMask={maskTimeline.activeKeyframe?.baseMask}
            strokes={maskTimeline.strokes}
            occlusionKeyframes={occlusionTimeline.keyframes}
            occlusionBaseMask={occlusionTimeline.activeKeyframe?.baseMask}
            occlusionStrokes={occlusionTimeline.strokes}
            editTarget={editTarget}
            objectPickEnabled={occlusionPicking}
            tool={tool}
            brushPercent={brushPercent}
            view={view}
            overlayVisible={overlayVisible}
            virtualCharacter={virtualCharacter}
            editingDisabled={isVideoExporting || occlusionBusy}
            onMetadata={setMetadata}
            onCommitStroke={(target, stroke) => {
              if (target === 'occlusion') occlusionTimeline.commitStroke(stroke)
              else maskTimeline.commitStroke(stroke)
            }}
            onPickOccluder={(point) => void pickOccluder(point)}
            onTimeChange={setCurrentTime}
          />
          {metadata && maskReady ? <MaskKeyframeRail duration={metadata.duration} currentTime={currentTime} keyframes={activeTimeline.keyframes} activeKeyframeId={activeTimeline.activeKeyframe?.id ?? null} hasExactKeyframe={Boolean(activeTimeline.exactKeyframe)} disabled={isVideoExporting || occlusionBusy} onAdd={activeTimeline.addKeyframe} onDelete={activeTimeline.deleteKeyframe} onApplyToStart={activeTimeline.applyToStart} onApplyToEnd={activeTimeline.applyToEnd} onSeek={(time) => stageRef.current?.seekTo(time)} /> : null}
        </div>
      </div>
      {exportError ? (
        <div role="alert" className="absolute bottom-5 right-5 rounded-lg border border-red-400/30 bg-red-950 px-4 py-2 text-sm text-red-200">
          {exportError}
        </div>
      ) : null}
      {libraryDialogOpen && lastExport ? <SaveToLibraryDialog asset={lastExport.asset} locale={locale} onClose={() => setLibraryDialogOpen(false)} /> : null}
    </main>
  )
}
