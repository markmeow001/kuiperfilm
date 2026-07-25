'use client'

import { AppIcon } from '@/components/ui/icons'

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

export interface DepthRebuildImageReference {
  url: string
  name: string
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
  characterReference: DepthRebuildImageReference | null
  sceneReference: DepthRebuildImageReference | null
  characterDescription: string
  sceneDescription: string
  modelOptions: readonly DepthRebuildModelOption[]
  modelKey: string
  resolutionOptions: readonly DepthRebuildResolutionOption[]
  resolution: string
  prompt: string
  promptStale: boolean
  generating: boolean
  interactionDisabled: boolean
  canGenerate: boolean
  estimatedCostLabel?: string | null
  errorMessage?: string | null
  blockingMessage?: string | null
  submittedRunId?: string | null
  canResume?: boolean
  hasResult?: boolean
  onVideoSelect: (file: File) => void
  onCreateDepthGuide: () => void
  onCancelDepthGuide?: () => void
  onCharacterSelect: (file: File) => void
  onCharacterPreviewError: () => void
  onSceneSelect: (file: File) => void
  onScenePreviewError: () => void
  onRemoveCharacter: () => void
  onRemoveScene: () => void
  onCharacterDescriptionChange: (value: string) => void
  onSceneDescriptionChange: (value: string) => void
  onModelChange: (value: string) => void
  onResolutionChange: (value: string) => void
  onBuildPrompt: () => void
  onGenerate: () => void
  onResetSubmittedRun?: () => void
}

interface ReferenceUploadProps {
  id: string
  label: string
  hint: string
  required?: boolean
  reference: DepthRebuildImageReference | null
  onSelect: (file: File) => void
  onPreviewError: () => void
  onRemove: () => void
  disabled: boolean
}

function ReferenceUpload({
  id,
  label,
  hint,
  required = false,
  reference,
  onSelect,
  onPreviewError,
  onRemove,
  disabled,
}: ReferenceUploadProps) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-stone-200">
          {label}
        </label>
        <span className={`text-xs ${required ? 'text-cyan-300' : 'text-stone-500'}`}>{required ? '必填' : '選填'}</span>
      </div>
      <p className="mb-2 text-xs leading-5 text-stone-500">{hint}</p>
      {reference ? (
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={reference.url}
            alt={`${label}預覽`}
            onError={onPreviewError}
            className="h-14 w-14 shrink-0 rounded-md object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-xs text-stone-300">{reference.name}</span>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="rounded-md border border-white/10 px-2 py-1 text-xs text-stone-400 hover:border-rose-300/30 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            移除
          </button>
        </div>
      ) : (
        <label htmlFor={id} className={`flex h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-white/[0.025] text-sm ${disabled ? 'cursor-not-allowed text-stone-600 opacity-50' : 'cursor-pointer text-stone-400 hover:border-cyan-300/30 hover:text-cyan-100'}`}>
          <AppIcon name="imageEdit" className="h-4 w-4" />
          上傳圖片
        </label>
      )}
      <input
        id={id}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onSelect(file)
        }}
      />
    </div>
  )
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
  characterReference,
  sceneReference,
  characterDescription,
  sceneDescription,
  modelOptions,
  modelKey,
  resolutionOptions,
  resolution,
  prompt,
  promptStale,
  generating,
  interactionDisabled,
  canGenerate,
  estimatedCostLabel = null,
  errorMessage = null,
  blockingMessage = null,
  submittedRunId = null,
  canResume = false,
  hasResult = false,
  onVideoSelect,
  onCreateDepthGuide,
  onCancelDepthGuide,
  onCharacterSelect,
  onCharacterPreviewError,
  onSceneSelect,
  onScenePreviewError,
  onRemoveCharacter,
  onRemoveScene,
  onCharacterDescriptionChange,
  onSceneDescriptionChange,
  onModelChange,
  onResolutionChange,
  onBuildPrompt,
  onGenerate,
  onResetSubmittedRun,
}: DepthRebuildPanelProps) {
  const hasDescriptions = characterDescription.trim().length > 0 && sceneDescription.trim().length > 0
  const canBuildPrompt = Boolean(source && depthGuide?.sufficient && characterReference && hasDescriptions)
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
        <p className="mt-2 text-xs leading-5 text-amber-200/80">目前一次鎖定一名主要新角色；多人交疊片段可保留整體走位，但其他人物的身份不保證精準。</p>
      </div>

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

          <label
            htmlFor="depth-rebuild-video"
            className={`mt-3 flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-sm transition-colors ${
              controlsDisabled || depthBusy
                ? 'cursor-not-allowed text-stone-600 opacity-50'
                : 'cursor-pointer text-stone-300 hover:border-cyan-300/30 hover:text-cyan-100'
            }`}
          >
            <AppIcon name="upload" className="h-4 w-4" />
            {source ? '更換表演影片' : '上傳 4–15 秒表演影片'}
          </label>
          <input
            id="depth-rebuild-video"
            type="file"
            accept="video/*"
            disabled={controlsDisabled || depthBusy}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onVideoSelect(file)
            }}
          />

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
          <p className="mt-2 text-xs leading-5 text-stone-500">參考圖可以先上傳，不必等深度分析完成，也不會在選圖時產生 AI 費用。</p>
          <div className="mt-4 space-y-5">
            <ReferenceUpload
              id="depth-rebuild-character"
              label="新角色圖片"
              hint="建議清楚的單人全身或半身照；這張圖只定義外貌、髮型與服裝。"
              required
              reference={characterReference}
              onSelect={onCharacterSelect}
              onPreviewError={onCharacterPreviewError}
              onRemove={onRemoveCharacter}
              disabled={controlsDisabled}
            />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-200">角色補充描述</span>
              <textarea
                value={characterDescription}
                disabled={controlsDisabled}
                onChange={(event) => onCharacterDescriptionChange(event.target.value)}
                placeholder="例如：電影寫實的 1930 年代女記者，深棕短髮，穿墨綠羊毛大衣；保留參考圖臉型與服裝細節"
                className="min-h-24 w-full resize-y rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-stone-200 outline-none placeholder:text-stone-600 focus:border-cyan-300/45"
              />
            </label>
            <ReferenceUpload
              id="depth-rebuild-scene"
              label="新場景圖片"
              hint="不傳圖也可以用文字描述場景；傳圖時用它固定主要建築、色調與構圖。"
              reference={sceneReference}
              onSelect={onSceneSelect}
              onPreviewError={onScenePreviewError}
              onRemove={onRemoveScene}
              disabled={controlsDisabled}
            />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-200">場景與動態描述</span>
              <textarea
                value={sceneDescription}
                disabled={controlsDisabled}
                onChange={(event) => onSceneDescriptionChange(event.target.value)}
                placeholder="例如：雨夜的 1930 年代上海街口，電車與路人持續移動，霓虹倒影隨鏡頭自然變化，不要靜態照片背景"
                className="min-h-24 w-full resize-y rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-stone-200 outline-none placeholder:text-stone-600 focus:border-cyan-300/45"
              />
            </label>
          </div>
        </section>

        <section className="px-4 py-5" aria-labelledby="depth-step-3">
          <StepHeading id="depth-step-3" number="03" title="建立並檢查 Prompt" state="免費" />
          <p className="mt-2 text-xs leading-5 text-stone-500">
            先把「深度影片、角色圖、場景圖」的用途寫清楚。修改任何素材或設定後，請重新建立 Prompt。
          </p>
          <button
            type="button"
            disabled={!canBuildPrompt || controlsDisabled}
            onClick={onBuildPrompt}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/[0.07] px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-300/[0.12] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.025] disabled:text-stone-600"
          >
            <AppIcon name="fileText" className="h-4 w-4" />
            {prompt ? '重新建立 Prompt' : '建立 Prompt'}
          </button>
          <label className="mt-3 block">
            <span className="mb-2 flex items-center justify-between text-xs text-stone-500">
              <span>送出前預覽</span>
              {promptStale && prompt ? <span className="text-amber-300">內容已變更，請重新建立</span> : null}
            </span>
            <textarea
              readOnly
              value={prompt}
              placeholder="完成深度影片並上傳新角色後，按「建立 Prompt」；系統不會在這一步送出生成。"
              className={`min-h-40 w-full resize-y rounded-lg border bg-black/25 px-3 py-2 font-mono text-xs leading-5 outline-none placeholder:text-stone-600 ${
                promptStale && prompt ? 'border-amber-300/40 text-stone-500' : 'border-white/10 text-stone-300'
              }`}
            />
          </label>
        </section>

        <section className="px-4 py-5" aria-labelledby="depth-step-4">
          <StepHeading id="depth-step-4" number="04" title="選擇品質並付費生成" />
          <p className="mt-2 text-xs leading-5 text-stone-500">只有按下最下方按鈕才會送出 AtlasCloud Seedance 2.0 任務並產生費用。</p>
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
          {errorMessage ? <div role="alert" className="mt-3 rounded-lg border border-rose-300/25 bg-rose-300/[0.06] px-3 py-2 text-xs leading-5 text-rose-200">{errorMessage}</div> : null}
          {!errorMessage && blockingMessage ? (
            <div role="status" className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.045] px-3 py-2 text-xs leading-5 text-amber-100/80">
              尚未送出：{blockingMessage}
            </div>
          ) : null}
          {canResume && submittedRunId ? (
            <div role="status" className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.055] px-3 py-2 text-xs leading-5 text-cyan-100">
              這筆付費任務已經送出（{submittedRunId}）。再次按下只會查詢同一筆任務，不會重新上傳或重複送出。
            </div>
          ) : null}
          {hasSettledSubmittedRun && onResetSubmittedRun ? (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-3 text-xs leading-5 text-stone-400">
              <p>
                {hasResult
                  ? '這個版本已完成。若要套用新的角色、場景或 Prompt，請先開始另一個版本。'
                  : '這筆已送出的任務已確認失敗。清除後才能依目前設定建立另一筆任務。'}
              </p>
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
            {generating
              ? 'AI 重建中…'
              : canResume
                ? '恢復查詢同一筆任務（不重複扣費）'
                : hasResult
                  ? '本次重建已完成'
                  : submittedRunId
                    ? '這筆任務已失敗'
                    : '確認費用並生成影片'}
          </button>
        </section>
      </div>
    </section>
  )
}
