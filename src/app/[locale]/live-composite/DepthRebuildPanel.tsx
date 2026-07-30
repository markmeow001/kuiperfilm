'use client'

import { useRef } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { SourceAudioMode } from '@/lib/playground/source-audio-contract'
import { DepthRebuildAudioModeSelector } from './DepthRebuildAudioModeSelector'
import { DepthRebuildReferenceSection } from './DepthRebuildReferenceSection'
import { DepthRebuildMotionContractPanel } from './DepthRebuildMotionContractPanel'
import { DepthRebuildGuidePlanPanel } from './DepthRebuildGuidePlanPanel'
import type { DepthRebuildGuidePlan } from './lib/depth-rebuild-guide-plan'
import type {
  CameraDirection,
  DepthRebuildMotionSettings,
  FramingCrop,
  SubjectMotionDirection,
} from './lib/depth-rebuild-motion-contract'
import type {
  DepthRebuildCharacterView,
  DepthRebuildSceneView,
} from './depth-rebuild-ui-types'

export interface DepthRebuildSourceSummary {
  name: string
  duration: number
  width: number
  height: number
}

export interface DepthGuideSummary {
  url: string
  effectiveFps: number
  sufficient: boolean
}

export interface DepthRebuildModelOption {
  value: string
  label: string
}

export interface DepthRebuildResolutionOption {
  value: string
  label: string
}

export interface DepthRebuildPanelProps {
  source: DepthRebuildSourceSummary | null
  depthGuide: DepthGuideSummary | null
  depthProgress?: number | null
  depthBusy: boolean
  characters: readonly DepthRebuildCharacterView[]
  sceneReferences: readonly DepthRebuildSceneView[]
  sceneBrief: string
  sceneDescription: string
  referenceImageCount: number
  maxReferenceImages: number
  descriptionAssistTarget: string | null
  modelOptions: readonly DepthRebuildModelOption[]
  modelKey: string
  resolutionOptions: readonly DepthRebuildResolutionOption[]
  resolution: string
  sourceAudioMode: SourceAudioMode
  sourceAudioDetected: boolean | null
  motionSettings: DepthRebuildMotionSettings
  guidePlan?: DepthRebuildGuidePlan | null
  criticalCenterSeconds?: number
  segmentCount: number
  segmentSummary: string
  prompt: string
  promptStale: boolean
  promptBlockingMessage?: string | null
  generating: boolean
  interactionDisabled: boolean
  canGenerate: boolean
  willPrepareDepthGuide?: boolean
  estimatedCostLabel?: string | null
  errorMessage?: string | null
  blockingMessage?: string | null
  submittedRunId?: string | null
  canResume?: boolean
  hasResult?: boolean
  onVideoSelect: (file: File) => void
  onCreateDepthGuide: () => void
  onCancelDepthGuide?: () => void
  onAddCharacter: () => void
  onRemoveCharacter: (characterId: string) => void
  onCharacterSelect: (characterId: string, file: File) => void
  onCharacterPreviewError: (characterId: string) => void
  onRemoveCharacterImage: (characterId: string) => void
  onCharacterLabelChange: (characterId: string, value: string) => void
  onCharacterSourceBindingChange: (characterId: string, value: string) => void
  onCharacterBriefChange: (characterId: string, value: string) => void
  onCharacterDescriptionChange: (characterId: string, value: string) => void
  onAssistCharacter: (characterId: string) => void
  onAddSceneImages: (files: readonly File[]) => void
  onRemoveSceneImage: (sceneId: string) => void
  onScenePreviewError: (sceneId: string) => void
  onSceneNoteChange: (sceneId: string, value: string) => void
  onSceneBriefChange: (value: string) => void
  onSceneDescriptionChange: (value: string) => void
  onAssistScene: () => void
  onModelChange: (value: string) => void
  onResolutionChange: (value: string) => void
  onSourceAudioModeChange: (value: SourceAudioMode) => void
  onCameraDirectionChange: (value: CameraDirection) => void
  onFramingCropChange: (value: FramingCrop) => void
  onSubjectDirectionChange: (value: SubjectMotionDirection) => void
  onSingleTakeChange: (value: boolean) => void
  onLockFramingChange: (value: boolean) => void
  onNoDirectionReversalChange: (value: boolean) => void
  onGazeSourceCharacterIdChange: (value: string | null) => void
  onGazeTargetCharacterIdChange: (value: string | null) => void
  onInteractionDescriptionChange: (value: string) => void
  onCriticalCenterChange?: (value: number) => void
  onBuildPrompt: () => void
  onGenerate: () => void
  onResetSubmittedRun?: () => void
}

function StepHeading({ id, number, title, state }: { id: string; number: string; title: string; state?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs tracking-[0.14em] text-cyan-300">{number}</span>
      <h3 id={id} className="text-sm font-semibold text-stone-100">{title}</h3>
      {state ? <span className="ml-auto text-xs text-stone-500">{state}</span> : null}
    </div>
  )
}

export function DepthRebuildPanel({
  source,
  depthGuide,
  depthProgress = null,
  depthBusy,
  characters,
  sceneReferences,
  sceneBrief,
  sceneDescription,
  referenceImageCount,
  maxReferenceImages,
  descriptionAssistTarget,
  modelOptions,
  modelKey,
  resolutionOptions,
  resolution,
  sourceAudioMode,
  sourceAudioDetected,
  motionSettings,
  guidePlan = null,
  criticalCenterSeconds = 0,
  prompt,
  promptStale,
  promptBlockingMessage = null,
  generating,
  interactionDisabled,
  canGenerate,
  willPrepareDepthGuide = false,
  estimatedCostLabel = null,
  errorMessage = null,
  blockingMessage = null,
  submittedRunId = null,
  canResume = false,
  hasResult = false,
  onVideoSelect,
  onCreateDepthGuide,
  onCancelDepthGuide,
  onAddCharacter,
  onRemoveCharacter,
  onCharacterSelect,
  onCharacterPreviewError,
  onRemoveCharacterImage,
  onCharacterLabelChange,
  onCharacterSourceBindingChange,
  onCharacterBriefChange,
  onCharacterDescriptionChange,
  onAssistCharacter,
  onAddSceneImages,
  onRemoveSceneImage,
  onScenePreviewError,
  onSceneNoteChange,
  onSceneBriefChange,
  onSceneDescriptionChange,
  onAssistScene,
  onModelChange,
  onResolutionChange,
  onSourceAudioModeChange,
  onCameraDirectionChange,
  onFramingCropChange,
  onSubjectDirectionChange,
  onSingleTakeChange,
  onLockFramingChange,
  onNoDirectionReversalChange,
  onGazeSourceCharacterIdChange,
  onGazeTargetCharacterIdChange,
  onInteractionDescriptionChange,
  onCriticalCenterChange,
  onBuildPrompt,
  onGenerate,
  onResetSubmittedRun,
}: DepthRebuildPanelProps) {
  const videoInputRef = useRef<HTMLInputElement>(null)
  const videoTriggerRef = useRef<HTMLButtonElement>(null)
  const hasEnabledModel = modelOptions.length > 0
  const selectedModelEnabled = modelOptions.some((option) => option.value === modelKey)
  const selectedResolutionAvailable = resolutionOptions.some((option) => option.value === resolution)
  const controlsDisabled = interactionDisabled || generating
  const hasSettledSubmittedRun = Boolean(submittedRunId && !canResume && !generating)
  const generateActionReady = canResume || (
    canGenerate
    && hasEnabledModel
    && !promptStale
    && Boolean(prompt)
    && submittedRunId === null
  )
  const depthPercent = depthProgress === null ? null : Math.round(Math.min(1, Math.max(0, depthProgress)) * 100)

  return (
    <section className="bg-[#0b0f13]" aria-label="AI 深度重建設定">
      <div className="border-b border-cyan-300/15 bg-cyan-300/[0.045] px-4 py-4">
        <p className="text-sm font-medium text-cyan-100">用深度影片傳遞動作，再重新生成整個畫面</p>
        <p className="mt-2 text-xs leading-5 text-stone-400">
          深度影片不是去背遮罩。它主要保留人物輪廓、走位、鏡頭構圖與節奏；臉部表情、口型、手指和前後遮擋仍可能被 AI 改寫，無法保證逐格一致。
        </p>
        <p className="mt-2 text-xs leading-5 text-amber-200/80">
          可依原片人物逐一指定新角色，人物與場景合計最多 9 張參考圖；深度影片另計、不占這 9 張。多人對應仍屬文字約束，交疊時無法保證百分之百不換人。
        </p>
        <p className="mt-2 text-xs leading-5 text-stone-400">
          不新增角色也能生成：保留原片表演者的數量與走位，只依場景描述重繪畫面（適合先測試深度引導效果）。只有一位角色時，人物對應可留空、自動綁定原片唯一表演者。
        </p>
      </div>
      {errorMessage ? (
        <div
          role="alert"
          className="mx-4 mt-4 rounded-lg border border-rose-300/25 bg-rose-300/[0.06] px-3 py-2 text-xs leading-5 text-rose-200"
        >
          {errorMessage}
        </div>
      ) : null}

      <div className="divide-y divide-white/10">
        <section className="px-4 py-5" aria-labelledby="depth-step-1">
          <StepHeading id="depth-step-1" number="01" title="產生本機深度影片" state={depthGuide ? '已產生' : source ? '可開始' : '等待原片'} />
          <p className="mt-2 text-xs leading-5 text-stone-500">
            在這台電腦分析原片，不呼叫付費模型。白色較近、黑色較遠，讓生成模型少受原服裝與背景干擾。
          </p>
          {source ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-stone-400">
              <span className="min-w-0 truncate text-stone-200">{source.name}</span>
              <span className="shrink-0">{source.duration.toFixed(1)}s · {source.width}×{source.height}</span>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-stone-500">選擇 4–15 秒的原始表演影片；上傳本身不會產生 AI 費用。</div>
          )}

          <div className="relative mt-3">
            <button
              ref={videoTriggerRef}
              type="button"
              disabled={controlsDisabled || depthBusy}
              onClick={() => videoInputRef.current?.click()}
              className={`flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                controlsDisabled || depthBusy
                  ? 'cursor-not-allowed text-stone-600 opacity-50'
                  : 'text-stone-300 hover:border-cyan-300/30 hover:text-cyan-100'
              }`}
            >
              <AppIcon name="upload" className="h-4 w-4" />
              {source ? '更換表演影片' : '上傳 4–15 秒表演影片'}
            </button>
            <input
              ref={videoInputRef}
              id="depth-rebuild-video"
              type="file"
              accept="video/*"
              aria-label={source ? '更換表演影片' : '上傳 4–15 秒表演影片'}
              tabIndex={-1}
              disabled={controlsDisabled || depthBusy}
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) {
                  onVideoSelect(file)
                  videoTriggerRef.current?.focus({ preventScroll: true })
                }
              }}
            />
          </div>

          {depthBusy ? (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between text-xs text-stone-400">
                <span>正在建立深度影片…</span>
                <span>{depthPercent === null ? '計算中' : `${depthPercent}%`}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-cyan-300 transition-[width]" style={{ width: `${depthPercent ?? 8}%` }} />
              </div>
              {onCancelDepthGuide ? (
                <button type="button" onClick={onCancelDepthGuide} className="mt-3 text-xs text-stone-400 underline decoration-stone-600 underline-offset-4 hover:text-white">
                  停止處理
                </button>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              disabled={!source || interactionDisabled}
              onClick={onCreateDepthGuide}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-3 text-sm font-semibold text-stone-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-stone-600"
            >
              <AppIcon name="scanLine" className="h-4 w-4" />
              {depthGuide ? '重新產生深度影片' : '產生深度影片（不扣點）'}
            </button>
          )}
          {depthGuide ? (
            <p className={`mt-2 text-xs ${depthGuide.sufficient ? 'text-emerald-300' : 'text-amber-300'}`}>
              有效深度更新 {depthGuide.effectiveFps.toFixed(1)} fps
              {depthGuide.sufficient ? '，可進入重建。' : '，更新率不足，請重新產生後再生成。'}
            </p>
          ) : null}
        </section>

        <section className="px-4 py-5" aria-labelledby="depth-step-2">
          <StepHeading id="depth-step-2" number="02" title="指定新角色與新場景" />
          <p className="mt-2 text-xs leading-5 text-stone-500">
            參考圖可以先上傳，不必等深度分析完成，也不會在選圖時產生 AI 費用。圖片會依人物在前、場景在後的順序編成 image 1–{maxReferenceImages}；單次重建不再占用銜接末幀名額。
          </p>
          <div className="mt-4">
            <DepthRebuildReferenceSection
              characters={characters}
              scenes={sceneReferences}
              sceneBrief={sceneBrief}
              sceneDescription={sceneDescription}
              used={referenceImageCount}
              max={maxReferenceImages}
              assistTarget={descriptionAssistTarget}
              controlsDisabled={controlsDisabled}
              onAddCharacter={onAddCharacter}
              onRemoveCharacter={onRemoveCharacter}
              onCharacterSelect={onCharacterSelect}
              onCharacterPreviewError={onCharacterPreviewError}
              onRemoveCharacterImage={onRemoveCharacterImage}
              onCharacterLabelChange={onCharacterLabelChange}
              onCharacterSourceBindingChange={onCharacterSourceBindingChange}
              onCharacterBriefChange={onCharacterBriefChange}
              onCharacterDescriptionChange={onCharacterDescriptionChange}
              onAssistCharacter={onAssistCharacter}
              onAddSceneImages={onAddSceneImages}
              onRemoveSceneImage={onRemoveSceneImage}
              onScenePreviewError={onScenePreviewError}
              onSceneNoteChange={onSceneNoteChange}
              onSceneBriefChange={onSceneBriefChange}
              onSceneDescriptionChange={onSceneDescriptionChange}
              onAssistScene={onAssistScene}
            />
          </div>
          <div className="mt-6 border-t border-white/10 pt-5">
            <DepthRebuildMotionContractPanel
              cameraDirection={motionSettings.cameraDirection}
              framingCrop={motionSettings.framingCrop}
              subjectDirection={motionSettings.subjectDirection}
              singleTake={motionSettings.singleTake}
              lockFraming={motionSettings.lockFraming}
              noDirectionReversal={motionSettings.noDirectionReversal}
              characters={characters.map((character) => ({
                id: character.id,
                label: character.label.trim() || '未命名角色',
              }))}
              gazeSourceCharacterId={motionSettings.gazeSourceCharacterId}
              gazeTargetCharacterId={motionSettings.gazeTargetCharacterId}
              interactionDescription={motionSettings.interactionDescription}
              disabled={controlsDisabled}
              onCameraDirectionChange={onCameraDirectionChange}
              onFramingCropChange={onFramingCropChange}
              onSubjectDirectionChange={onSubjectDirectionChange}
              onSingleTakeChange={onSingleTakeChange}
              onLockFramingChange={onLockFramingChange}
              onNoDirectionReversalChange={onNoDirectionReversalChange}
              onGazeSourceCharacterIdChange={onGazeSourceCharacterIdChange}
              onGazeTargetCharacterIdChange={onGazeTargetCharacterIdChange}
              onInteractionDescriptionChange={onInteractionDescriptionChange}
            />
          </div>
        </section>

        <section className="px-4 py-5" aria-labelledby="depth-step-3">
          <StepHeading id="depth-step-3" number="03" title="建立並檢查 Prompt" state="免費" />
          <p className="mt-2 text-xs leading-5 text-stone-500">
            先檢查角色、場景、image 對應與引導片段。深度影片品質會在最後付費生成前檢查，不會阻止您先建立 Prompt。
          </p>
          {guidePlan ? (
            <div className="mt-3">
              <DepthRebuildGuidePlanPanel
                strategy={guidePlan.strategy === 'full-depth-full-rgb'
                  ? 'full-dual'
                  : guidePlan.strategy === 'full-depth-critical-rgb'
                    ? 'depth-plus-detail'
                    : 'depth-only'}
                sourceDuration={guidePlan.sourceDurationSeconds}
                outputDuration={guidePlan.outputDurationSeconds}
                primaryDuration={guidePlan.fullDepth.durationSeconds}
                secondaryStart={guidePlan.secondary?.sourceStartSeconds ?? 0}
                secondaryDuration={guidePlan.secondary?.durationSeconds ?? 0}
                totalReferenceDuration={guidePlan.totalReferenceSeconds}
                maxReferenceDuration={guidePlan.budget.hardLimitSeconds}
                criticalCenterSeconds={criticalCenterSeconds}
                disabled={controlsDisabled}
                onCriticalCenterChange={onCriticalCenterChange ?? (() => undefined)}
              />
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.045] px-3 py-2 text-xs leading-5 text-amber-100/85">
              尚未建立合法引導計畫；原片需介於 4–15 秒。
            </div>
          )}
          <div
            id="depth-rebuild-prompt-readiness"
            aria-live="polite"
            className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${
              promptBlockingMessage
                ? 'border-amber-300/20 bg-amber-300/[0.045] text-amber-100/85'
                : 'border-emerald-300/20 bg-emerald-300/[0.045] text-emerald-100/85'
            }`}
          >
            <span className="font-medium">
              {promptBlockingMessage ? '下一步：' : '資料已完成：'}
            </span>
            {promptBlockingMessage ?? '可以建立 Prompt；送出時會先在本機建立深度引導，成功後才進入付費生成。'}
          </div>
          <button
            type="button"
            aria-describedby="depth-rebuild-prompt-readiness"
            disabled={controlsDisabled}
            onClick={onBuildPrompt}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/[0.07] px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-300/[0.12] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.025] disabled:text-stone-600"
          >
            <AppIcon name="fileText" className="h-4 w-4" />
            {prompt ? '重新檢查並建立 Prompt' : '檢查並建立 Prompt'}
          </button>
          <label className="mt-3 block">
            <span className="mb-2 flex items-center justify-between text-xs text-stone-500">
              <span>送出前預覽</span>
              {promptStale && prompt ? <span className="text-amber-300">內容已變更，請重新建立</span> : null}
            </span>
            <textarea
              readOnly
              value={prompt}
              placeholder="完成角色與場景設定後，按「檢查並建立 Prompt」；系統不會在這一步送出生成。"
              className={`min-h-40 w-full resize-y rounded-lg border bg-black/25 px-3 py-2 font-mono text-xs leading-5 outline-none placeholder:text-stone-600 ${
                promptStale && prompt ? 'border-amber-300/40 text-stone-500' : 'border-white/10 text-stone-300'
              }`}
            />
          </label>
        </section>

        <section className="px-4 py-5" aria-labelledby="depth-step-4">
          <StepHeading id="depth-step-4" number="04" title="選擇品質並付費生成" />
          <p className="mt-2 text-xs leading-5 text-stone-500">只有按下最下方按鈕才會送出 AtlasCloud Seedance 2.0 任務並產生費用。</p>
          <DepthRebuildAudioModeSelector
            value={sourceAudioMode}
            sourceAudioDetected={sourceAudioDetected}
            disabled={controlsDisabled}
            onChange={onSourceAudioModeChange}
          />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <label className="text-xs text-stone-500">
              模型
              <select
                value={modelKey}
                disabled={controlsDisabled || !hasEnabledModel}
                onChange={(event) => onModelChange(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-[#10151b] px-2 text-sm text-stone-200 outline-none focus:border-violet-300/45 disabled:opacity-50"
              >
                {!hasEnabledModel ? <option value="">帳號未啟用可用模型</option> : null}
                {hasEnabledModel && !selectedModelEnabled ? (
                  <option value={modelKey} disabled>目前模型未啟用，請重新選擇</option>
                ) : null}
                {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-stone-500">
              輸出解析度
              <select
                value={resolution}
                disabled={controlsDisabled}
                onChange={(event) => onResolutionChange(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-[#10151b] px-2 text-sm text-stone-200 outline-none focus:border-violet-300/45 disabled:opacity-50"
              >
                {!selectedResolutionAvailable ? (
                  <option value={resolution} disabled>目前解析度不支援，請重新選擇</option>
                ) : null}
                {resolutionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          {!hasEnabledModel ? (
            <div role="status" className="mt-3 rounded-lg border border-amber-300/25 bg-amber-300/[0.06] px-3 py-2 text-xs leading-5 text-amber-200">
              此帳號尚未啟用 AtlasCloud Seedance 2.0 Fast 或 Standard，請先到模型設定中心啟用後再生成。
            </div>
          ) : null}
          {!errorMessage && blockingMessage && !willPrepareDepthGuide ? (
            <div role="status" className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.045] px-3 py-2 text-xs leading-5 text-amber-100/80">
              尚未送出：{blockingMessage}
            </div>
          ) : null}
          {!errorMessage && willPrepareDepthGuide ? (
            <div role="status" className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.055] px-3 py-2 text-xs leading-5 text-cyan-100">
              按下後會先在本機建立深度引導影片（不扣點），成功後才會自動送出下方顯示的付費任務。
            </div>
          ) : null}
          {canResume && submittedRunId ? (
            <div role="status" className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.055] px-3 py-2 text-xs leading-5 text-cyan-100">
              這筆付費任務已經送出（{submittedRunId}）。再次按下只會查詢同一筆任務，不會重新上傳或重複送出。
            </div>
          ) : null}
          {canResume && !submittedRunId ? (
            <div role="status" className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.055] px-3 py-2 text-xs leading-5 text-cyan-100">
              上次送出時網路回應中斷，任務可能已經建立。按下後會沿用同一個請求安全恢復，不會重新上傳，也不會建立第二筆付費任務。
            </div>
          ) : null}
          {hasSettledSubmittedRun && onResetSubmittedRun ? (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-3 text-xs leading-5 text-stone-400">
              <p>
                {hasResult
                  ? '這個版本已完成。若要套用新的角色、場景或 Prompt，請先開始另一個版本。'
                  : '這筆已送出的任務已確認失敗。清除後才能依目前設定建立另一筆任務。'}
              </p>
              {!hasResult && errorMessage ? (
                <p role="alert" className="mt-2 text-rose-200">
                  失敗原因：{errorMessage}
                </p>
              ) : null}
              <button
                type="button"
                onClick={onResetSubmittedRun}
                className="mt-2 rounded-md border border-white/15 px-2.5 py-1.5 text-xs text-stone-200 hover:border-cyan-300/35 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
              >
                {hasResult ? '開始另一個版本' : '清除失敗任務'}
              </button>
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-3 text-xs">
            <span className="text-stone-500">預估費用</span>
            <span className="font-mono text-violet-200">{estimatedCostLabel ?? '完成設定後顯示'}</span>
          </div>
          <button
            type="button"
            disabled={!generateActionReady || controlsDisabled}
            onClick={onGenerate}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-300 px-3 text-sm font-semibold text-violet-950 hover:bg-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-100 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-stone-600"
          >
            <AppIcon name={generating ? 'loader' : 'sparkles'} className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
            {depthBusy
              ? '正在建立深度引導影片…'
              : generating
              ? 'AI 重建中…'
              : canResume
                ? submittedRunId
                  ? '恢復查詢同一筆任務（不重複扣費）'
                  : '安全恢復上次送出（不重複扣費）'
                : hasResult
                  ? '本次重建已完成'
                  : submittedRunId
                    ? '這筆任務已失敗'
                    : willPrepareDepthGuide
                      ? '建立深度引導並生成影片'
                      : '確認費用並生成影片'}
          </button>
        </section>
      </div>
    </section>
  )
}
