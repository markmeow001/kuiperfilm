'use client'

import { AiMaskPanel, type AiMaskSettings } from './AiMaskPanel'
import { CompositeExportPanel } from './CompositeExportPanel'
import type { CompositeExportProgress, MaskAnalysisProgress, MaskKeyframe, VideoMetadata, VirtualCharacterLayer } from './live-composite-types'
import { UploadFileButton } from './UploadFileButton'
import { VirtualCharacterPanel } from './VirtualCharacterPanel'
import { OcclusionPanel } from './OcclusionPanel'
import { BackgroundGeneratorPanel } from './BackgroundGeneratorPanel'

interface CompositeAssetPanelProps {
  metadata: VideoMetadata | null
  backgroundColor: string
  hasBackgroundImage: boolean
  canExport: boolean
  currentTime: number
  analysisProgress: MaskAnalysisProgress
  exportProgress: CompositeExportProgress
  interactionDisabled: boolean
  virtualCharacter: VirtualCharacterLayer | null
  maskKeyframes: MaskKeyframe[]
  occlusionPicking: boolean
  occlusionBusy: boolean
  occlusionMessage: string | null
  occlusionKeyframeCount: number
  onVideoSelect: (file: File) => void
  onBackgroundSelect: (file: File) => void
  onBackgroundColorChange: (color: string) => void
  onVirtualCharacterSelect: (file: File) => void
  onVirtualCharacterChange: (patch: Partial<VirtualCharacterLayer>) => void
  onVirtualCharacterRemove: () => void
  onVirtualCharacterAutoMatch: () => void
  motionBusy: boolean
  motionMessage: string | null
  onAnalyzeMotionCurrent: () => void
  onAnalyzeMotionClip: () => void
  onStartOcclusionPicking: () => void
  onCancelOcclusionPicking: () => void
  onExportMask: () => void
  onExportFrame: () => void
  onExportVideo: (includeAudio: boolean) => void
  onCancelVideoExport: () => void
  onAnalyzeCurrent: (settings: AiMaskSettings) => void
  onAnalyzeClip: (settings: AiMaskSettings) => void
  onCancelAnalysis: () => void
  lastExportLabel?: string | null
  onSaveToLibrary?: () => void
}

export function CompositeAssetPanel({
  metadata,
  backgroundColor,
  hasBackgroundImage,
  canExport,
  currentTime,
  analysisProgress,
  exportProgress,
  interactionDisabled,
  virtualCharacter,
  maskKeyframes,
  occlusionPicking,
  occlusionBusy,
  occlusionMessage,
  occlusionKeyframeCount,
  onVideoSelect,
  onBackgroundSelect,
  onBackgroundColorChange,
  onVirtualCharacterSelect,
  onVirtualCharacterChange,
  onVirtualCharacterRemove,
  onVirtualCharacterAutoMatch,
  motionBusy,
  motionMessage,
  onAnalyzeMotionCurrent,
  onAnalyzeMotionClip,
  onStartOcclusionPicking,
  onCancelOcclusionPicking,
  onExportMask,
  onExportFrame,
  onExportVideo,
  onCancelVideoExport,
  onAnalyzeCurrent,
  onAnalyzeClip,
  onCancelAnalysis,
  lastExportLabel = null,
  onSaveToLibrary,
}: CompositeAssetPanelProps) {
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-stone-950/80">
      <div className="border-b border-white/10 px-4 py-4">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">素材</div>
        <div className="mt-3 space-y-2">
          <UploadFileButton disabled={interactionDisabled} label={metadata ? '更換實拍影片' : '上傳實拍影片'} accept="video/*" kind="video" onSelect={onVideoSelect} />
          <UploadFileButton disabled={interactionDisabled} label={hasBackgroundImage ? '更換背景圖片' : '上傳背景圖片'} accept="image/*" kind="image" onSelect={onBackgroundSelect} />
        </div>
        {metadata ? (
          <div className="mt-3 rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-5 text-stone-500">
            <div className="truncate text-stone-300">{metadata.name}</div>
            <div>{metadata.width} × {metadata.height}</div>
            <div>{metadata.duration.toFixed(1)} 秒</div>
          </div>
        ) : null}
      </div>

      <div className="border-b border-white/10 px-4 py-4">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">背景</div>
        <label className="mt-3 flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm text-stone-400">
          純色背景
          <input type="color" value={backgroundColor} disabled={interactionDisabled} onChange={(event) => onBackgroundColorChange(event.target.value)} className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent disabled:cursor-not-allowed" />
        </label>
      </div>

      <BackgroundGeneratorPanel metadata={metadata} disabled={interactionDisabled} onGenerated={onBackgroundSelect} />

      <VirtualCharacterPanel
        layer={virtualCharacter}
        keyframes={maskKeyframes}
        currentTime={currentTime}
        duration={metadata?.duration ?? 0}
        disabled={interactionDisabled || !metadata}
        onSelect={onVirtualCharacterSelect}
        onChange={onVirtualCharacterChange}
        onRemove={onVirtualCharacterRemove}
        onAutoMatch={onVirtualCharacterAutoMatch}
        motionBusy={motionBusy}
        motionMessage={motionMessage}
        onAnalyzeMotionCurrent={onAnalyzeMotionCurrent}
        onAnalyzeMotionClip={onAnalyzeMotionClip}
      />

      <OcclusionPanel
        disabled={interactionDisabled || !metadata || !virtualCharacter}
        picking={occlusionPicking}
        busy={occlusionBusy}
        message={occlusionMessage}
        keyframeCount={occlusionKeyframeCount}
        onStartPicking={onStartOcclusionPicking}
        onCancelPicking={onCancelOcclusionPicking}
      />

      <AiMaskPanel
        canAnalyze={Boolean(metadata) && !interactionDisabled}
        currentTime={currentTime}
        progress={analysisProgress}
        onAnalyzeCurrent={onAnalyzeCurrent}
        onAnalyzeClip={onAnalyzeClip}
        onCancel={onCancelAnalysis}
      />

      <CompositeExportPanel
        canExport={canExport}
        progress={exportProgress}
        onExportMask={onExportMask}
        onExportFrame={onExportFrame}
        onExportVideo={onExportVideo}
        onCancelVideo={onCancelVideoExport}
        lastExportLabel={lastExportLabel}
        onSaveToLibrary={onSaveToLibrary}
      />
    </aside>
  )
}
