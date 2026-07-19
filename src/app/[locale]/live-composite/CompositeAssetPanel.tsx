'use client'

import { AiMaskPanel, type AiMaskSettings } from './AiMaskPanel'
import { CompositeExportPanel } from './CompositeExportPanel'
import type { CompositeExportProgress, MaskAnalysisProgress, MaskKeyframe, VideoMetadata, VirtualCharacterLayer } from './live-composite-types'
import { UploadFileButton } from './UploadFileButton'
import { VirtualCharacterPanel } from './VirtualCharacterPanel'
import { OcclusionPanel } from './OcclusionPanel'
import { BackgroundGeneratorPanel } from './BackgroundGeneratorPanel'
import { LiveCompositeWorkflowGuide, type LiveCompositeWorkflowStep } from './LiveCompositeWorkflowGuide'

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
  workflowStep: LiveCompositeWorkflowStep
  completedWorkflowSteps: ReadonlySet<LiveCompositeWorkflowStep>
  onWorkflowStepChange: (step: LiveCompositeWorkflowStep) => void
}

interface StepNavigationProps {
  back?: LiveCompositeWorkflowStep
  next?: LiveCompositeWorkflowStep
  nextLabel?: string
  onStepChange: (step: LiveCompositeWorkflowStep) => void
}

function StepNavigation({ back, next, nextLabel = '下一步', onStepChange }: StepNavigationProps) {
  return (
    <div className="flex gap-2 border-t border-white/10 px-4 py-4">
      {back ? (
        <button type="button" onClick={() => onStepChange(back)} className="h-10 rounded-lg border border-white/10 px-3 text-sm text-stone-400 hover:bg-white/[0.05] hover:text-white">
          上一步
        </button>
      ) : null}
      {next ? (
        <button type="button" onClick={() => onStepChange(next)} className="h-10 flex-1 rounded-lg bg-cyan-400 px-3 text-sm font-medium text-stone-950 hover:bg-cyan-300">
          {nextLabel}
        </button>
      ) : null}
    </div>
  )
}

export function CompositeAssetPanel({ metadata, backgroundColor, hasBackgroundImage, canExport, currentTime, analysisProgress, exportProgress, interactionDisabled, virtualCharacter, maskKeyframes, occlusionPicking, occlusionBusy, occlusionMessage, occlusionKeyframeCount, onVideoSelect, onBackgroundSelect, onBackgroundColorChange, onVirtualCharacterSelect, onVirtualCharacterChange, onVirtualCharacterRemove, onVirtualCharacterAutoMatch, motionBusy, motionMessage, onAnalyzeMotionCurrent, onAnalyzeMotionClip, onStartOcclusionPicking, onCancelOcclusionPicking, onExportMask, onExportFrame, onExportVideo, onCancelVideoExport, onAnalyzeCurrent, onAnalyzeClip, onCancelAnalysis, lastExportLabel = null, onSaveToLibrary, workflowStep, completedWorkflowSteps, onWorkflowStepChange }: CompositeAssetPanelProps) {
  return (
    <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-stone-950/80">
      <LiveCompositeWorkflowGuide activeStep={workflowStep} completedSteps={completedWorkflowSteps} onStepChange={onWorkflowStepChange} />

      {workflowStep === 1 ? (
        <>
          <div className="border-b border-white/10 px-4 py-5">
            <p className="mb-4 text-sm leading-6 text-stone-400">先上傳要處理的實拍影片。影片只在瀏覽器中分析，不會因人物辨識而上傳。</p>
            <div className="mt-3 space-y-2">
              <UploadFileButton disabled={interactionDisabled} label={metadata ? '更換實拍影片' : '上傳實拍影片'} accept="video/*" kind="video" onSelect={onVideoSelect} />
            </div>
            {metadata ? (
              <div className="mt-3 rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-5 text-stone-500">
                <div className="truncate text-stone-300">{metadata.name}</div>
                <div>
                  {metadata.width} × {metadata.height}
                </div>
                <div>{metadata.duration.toFixed(1)} 秒</div>
              </div>
            ) : null}
          </div>
          {metadata ? <StepNavigation next={2} nextLabel="下一步：AI 辨識人物" onStepChange={onWorkflowStepChange} /> : null}
        </>
      ) : null}

      {workflowStep === 2 ? (
        <>
          <AiMaskPanel canAnalyze={Boolean(metadata) && !interactionDisabled} currentTime={currentTime} progress={analysisProgress} onAnalyzeCurrent={onAnalyzeCurrent} onAnalyzeClip={onAnalyzeClip} onCancel={onCancelAnalysis} />
          <StepNavigation back={1} next={completedWorkflowSteps.has(2) ? 3 : undefined} nextLabel="下一步：檢查人物邊緣" onStepChange={onWorkflowStepChange} />
        </>
      ) : null}

      {workflowStep === 3 ? (
        <>
          <section className="border-b border-white/10 px-4 py-5">
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4">
              <div className="text-sm font-medium text-cyan-100">檢查畫面中的人物邊緣</div>
              <ol className="mt-3 space-y-2 text-xs leading-5 text-stone-400">
                <li>
                  <span className="mr-2 text-cyan-300">1</span>
                  拖動下方播放時間，查看頭髮、手指與快速移動處。
                </li>
                <li>
                  <span className="mr-2 text-cyan-300">2</span>
                  少選到人物時，使用上方「補回人物」。
                </li>
                <li>
                  <span className="mr-2 text-cyan-300">3</span>
                  背景被誤選時，使用「擦除錯選」。
                </li>
              </ol>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-stone-600">一般情況不需要操作下方的時間遮罩；只有某一小段特別不準時，再展開進階修正。</p>
          </section>
          <StepNavigation back={2} next={4} nextLabel="遮罩沒問題，下一步換背景" onStepChange={onWorkflowStepChange} />
        </>
      ) : null}

      {workflowStep === 4 ? (
        <>
          <section className="border-b border-white/10 px-4 py-5">
            <p className="mb-4 text-sm leading-6 text-stone-400">選擇一張現成背景、使用純色，或生成一張「背景概念圖」作為構圖預覽／概念參考。</p>
            <UploadFileButton disabled={interactionDisabled} label={hasBackgroundImage ? '更換背景圖片' : '上傳背景圖片'} accept="image/*" kind="image" onSelect={onBackgroundSelect} />
            <label className="mt-3 flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm text-stone-400">
              使用純色背景
              <input type="color" value={backgroundColor} disabled={interactionDisabled} onChange={(event) => onBackgroundColorChange(event.target.value)} className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent disabled:cursor-not-allowed" />
            </label>
          </section>
          <BackgroundGeneratorPanel metadata={metadata} disabled={interactionDisabled} onGenerated={onBackgroundSelect} />
          <StepNavigation back={3} next={5} nextLabel="下一步：虛擬角色（可略過）" onStepChange={onWorkflowStepChange} />
        </>
      ) : null}

      {workflowStep === 5 ? (
        <>
          <section className="border-b border-white/10 px-4 py-4 text-xs leading-5 text-stone-500">這一步是選用功能。只換背景時可以直接前往輸出；需要廣告角色或動畫角色互動時，再上傳透明素材。</section>
          <VirtualCharacterPanel layer={virtualCharacter} keyframes={maskKeyframes} currentTime={currentTime} duration={metadata?.duration ?? 0} disabled={interactionDisabled || !metadata} onSelect={onVirtualCharacterSelect} onChange={onVirtualCharacterChange} onRemove={onVirtualCharacterRemove} onAutoMatch={onVirtualCharacterAutoMatch} motionBusy={motionBusy} motionMessage={motionMessage} onAnalyzeMotionCurrent={onAnalyzeMotionCurrent} onAnalyzeMotionClip={onAnalyzeMotionClip} />
          {virtualCharacter ? (
            <details className="border-b border-white/10">
              <summary className="cursor-pointer list-none px-4 py-3 text-xs text-amber-200 hover:bg-amber-400/[0.04]">進階：讓桌子、門框等物件擋住角色 ▾</summary>
              <OcclusionPanel disabled={interactionDisabled || !metadata || !virtualCharacter} picking={occlusionPicking} busy={occlusionBusy} message={occlusionMessage} keyframeCount={occlusionKeyframeCount} onStartPicking={onStartOcclusionPicking} onCancelPicking={onCancelOcclusionPicking} />
            </details>
          ) : null}
          <StepNavigation back={4} next={6} nextLabel={virtualCharacter ? '下一步：預覽與輸出' : '略過角色，前往輸出'} onStepChange={onWorkflowStepChange} />
        </>
      ) : null}

      {workflowStep === 6 ? (
        <>
          <section className="border-b border-white/10 px-4 py-4 text-xs leading-5 text-stone-500">先在右上角切換「3 合成預覽」確認畫面，再輸出單格或完整影片。</section>
          <CompositeExportPanel canExport={canExport} progress={exportProgress} onExportMask={onExportMask} onExportFrame={onExportFrame} onExportVideo={onExportVideo} onCancelVideo={onCancelVideoExport} lastExportLabel={lastExportLabel} onSaveToLibrary={onSaveToLibrary} />
          <StepNavigation back={5} onStepChange={onWorkflowStepChange} />
        </>
      ) : null}
    </aside>
  )
}
