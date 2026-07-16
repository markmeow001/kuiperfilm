'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AppIcon } from '@/components/ui/icons'
import type { AiMaskSettings } from './AiMaskPanel'
import { CompositeAssetPanel } from './CompositeAssetPanel'
import { CompositeToolbar } from './CompositeToolbar'
import { MaskKeyframeRail } from './MaskKeyframeRail'
import { MaskStage, type MaskStageHandle } from './MaskStage'
import { buildMaskAnalysisTimes } from './lib/mask-analysis'
import { CompositeRecordingCancelledError } from './lib/composite-video-recorder'
import { useMaskTimeline } from './useMaskTimeline'
import type { CompositeExportProgress, CompositeView, MaskAnalysisProgress, MaskTool, VideoMetadata } from './live-composite-types'

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

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function LiveCompositeClient({ locale }: LiveCompositeClientProps) {
  const stageRef = useRef<MaskStageHandle>(null)
  const analysisRunRef = useRef(0)
  const analysisRestoreTimeRef = useRef<number | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string | null>(null)
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  const [backgroundColor, setBackgroundColor] = useState('#172033')
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const maskTimeline = useMaskTimeline(currentTime)
  const [tool, setTool] = useState<MaskTool>('keep')
  const [view, setView] = useState<CompositeView>('source')
  const [brushPercent, setBrushPercent] = useState(6)
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [exportError, setExportError] = useState<string | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState<MaskAnalysisProgress>(INITIAL_ANALYSIS_PROGRESS)
  const [exportProgress, setExportProgress] = useState<CompositeExportProgress>(INITIAL_EXPORT_PROGRESS)
  const isVideoExporting = exportProgress.status === 'preparing' || exportProgress.status === 'recording'
  const isAnalyzing = analysisProgress.status === 'loading-model' || analysisProgress.status === 'analyzing'

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
  }, [videoUrl])

  useEffect(() => () => {
    if (backgroundUrl) URL.revokeObjectURL(backgroundUrl)
  }, [backgroundUrl])

  const selectVideo = (file: File) => {
    if (isVideoExporting) return
    analysisRunRef.current += 1
    setVideoUrl(URL.createObjectURL(file))
    setVideoName(file.name)
    setMetadata(null)
    setCurrentTime(0)
    maskTimeline.reset()
    setView('source')
    setExportError(null)
    setAnalysisProgress(INITIAL_ANALYSIS_PROGRESS)
    setExportProgress(INITIAL_EXPORT_PROGRESS)
  }

  const selectBackground = (file: File) => {
    if (isVideoExporting) return
    setBackgroundUrl(URL.createObjectURL(file))
    setView('composite')
    setExportError(null)
  }

  const exportMask = async () => {
    try {
      setExportError(null)
      const blob = await stageRef.current?.exportMask()
      if (!blob) throw new Error('遮罩尚未準備完成')
      downloadBlob(blob, 'kuiper-mask.png')
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
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '合成影格輸出失敗')
    }
  }

  const exportVideo = async (includeAudio: boolean) => {
    const stage = stageRef.current
    if (!stage || !metadata || isAnalyzing || isVideoExporting) {
      setExportProgress({ status: 'failed', currentTime: 0, duration: 0, message: '請先載入影片。' })
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
      setExportProgress({
        status: 'completed',
        currentTime: metadata.duration,
        duration: metadata.duration,
        message: `合成影片已完成（${result.mimeType}）。`,
      })
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
    setAnalysisProgress({ status: 'idle', completed: 0, total: 0, message: '已取消；未套用未完成的分析結果。' })
  }

  const runPersonAnalysis = async (times: number[], settings: AiMaskSettings) => {
    const stage = stageRef.current
    if (!stage || !metadata) {
      setAnalysisProgress({ status: 'failed', completed: 0, total: 0, message: '請先載入可分析的影片。' })
      return
    }

    const runId = analysisRunRef.current + 1
    analysisRunRef.current = runId
    const restoreTime = currentTime
    analysisRestoreTimeRef.current = restoreTime
    setAnalysisProgress({ status: 'loading-model', completed: 0, total: times.length, message: '正在載入本機人物分割模型…' })

    try {
      const frames = []
      for (let index = 0; index < times.length; index += 1) {
        if (analysisRunRef.current !== runId) return
        const time = times[index]
        setAnalysisProgress({
          status: 'analyzing',
          completed: index,
          total: times.length,
          message: `分析 ${time.toFixed(2)} 秒的人物輪廓…`,
        })
        const mask = await stage.analyzePersonAt(time, settings.threshold, settings.edgeSoftness)
        if (analysisRunRef.current !== runId) return
        frames.push({ time, mask })
        setAnalysisProgress({
          status: 'analyzing',
          completed: index + 1,
          total: times.length,
          message: `已完成 ${index + 1} / ${times.length} 個分析影格`,
        })
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }

      maskTimeline.applyAiMasks(frames)
      setView('composite')
      setOverlayVisible(true)
      setAnalysisProgress({
        status: 'completed',
        completed: times.length,
        total: times.length,
        message: `AI 人物遮罩完成：已建立 ${times.length} 個可手動修正的關鍵影格。`,
      })
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

  const analyzeCurrent = (settings: AiMaskSettings) => {
    void runPersonAnalysis([currentTime], settings)
  }

  const analyzeClip = (settings: AiMaskSettings) => {
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

  return (
    <main className="flex h-screen min-h-[680px] flex-col overflow-hidden bg-[#09090b] text-stone-100">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-stone-950 px-5">
        <div className="flex items-center gap-4">
          <Link href={`/${locale}/v2`} aria-label="回到專案列表" className="grid h-9 w-9 place-items-center rounded-lg text-stone-500 hover:bg-white/10 hover:text-white">
            <AppIcon name="arrowLeft" className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium"><AppIcon name="sparklesAlt" className="h-4 w-4 text-cyan-300" />AI 實拍合成台</div>
            <div className="mt-0.5 text-xs text-stone-600">Live Composite Studio · Mask MVP</div>
          </div>
        </div>
        <div className="flex items-center gap-5 text-xs text-stone-500">
          <span className="flex items-center gap-1.5 text-emerald-400"><AppIcon name="circleCheck" className="h-3.5 w-3.5" />時間型遮罩 · {maskTimeline.keyframes.length} 個關鍵影格</span>
          <span className="text-violet-300">AI 人物辨識 · 本機 MediaPipe</span>
          <span className="text-cyan-300">影片合成輸出 · 本機錄製</span>
        </div>
      </header>

      <CompositeToolbar
        tool={tool}
        view={view}
        brushPercent={brushPercent}
        overlayVisible={overlayVisible}
        canUndo={maskTimeline.canUndo}
        canRedo={maskTimeline.canRedo}
        disabled={isVideoExporting}
        onToolChange={setTool}
        onViewChange={setView}
        onBrushPercentChange={setBrushPercent}
        onOverlayVisibleChange={setOverlayVisible}
        onUndo={maskTimeline.undo}
        onRedo={maskTimeline.redo}
        onClear={maskTimeline.clearCurrent}
      />

      <div className="flex min-h-0 flex-1">
        <CompositeAssetPanel
          metadata={metadata}
          backgroundColor={backgroundColor}
          hasBackgroundImage={Boolean(backgroundUrl)}
          canExport={Boolean(metadata) && !isAnalyzing}
          currentTime={currentTime}
          analysisProgress={analysisProgress}
          exportProgress={exportProgress}
          interactionDisabled={isVideoExporting}
          onVideoSelect={selectVideo}
          onBackgroundSelect={selectBackground}
          onBackgroundColorChange={setBackgroundColor}
          onExportMask={exportMask}
          onExportFrame={exportFrame}
          onExportVideo={(includeAudio) => void exportVideo(includeAudio)}
          onCancelVideoExport={cancelVideoExport}
          onAnalyzeCurrent={analyzeCurrent}
          onAnalyzeClip={analyzeClip}
          onCancelAnalysis={cancelAnalysis}
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
            tool={tool}
            brushPercent={brushPercent}
            view={view}
            overlayVisible={overlayVisible}
            editingDisabled={isVideoExporting}
            onMetadata={setMetadata}
            onCommitStroke={maskTimeline.commitStroke}
            onTimeChange={setCurrentTime}
          />
          {metadata ? (
            <MaskKeyframeRail
              duration={metadata.duration}
              currentTime={currentTime}
              keyframes={maskTimeline.keyframes}
              activeKeyframeId={maskTimeline.activeKeyframe?.id ?? null}
              hasExactKeyframe={Boolean(maskTimeline.exactKeyframe)}
              disabled={isVideoExporting}
              onAdd={maskTimeline.addKeyframe}
              onDelete={maskTimeline.deleteKeyframe}
              onApplyToStart={maskTimeline.applyToStart}
              onApplyToEnd={maskTimeline.applyToEnd}
              onSeek={(time) => stageRef.current?.seekTo(time)}
            />
          ) : null}
        </div>
      </div>
      {exportError ? <div role="alert" className="absolute bottom-5 right-5 rounded-lg border border-red-400/30 bg-red-950 px-4 py-2 text-sm text-red-200">{exportError}</div> : null}
    </main>
  )
}
