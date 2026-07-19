'use client'

import type { ChangeEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { PlaygroundController } from './usePlaygroundController'

type ReconstructionModel = PlaygroundController['videoModels'][number]

export interface ReconstructionReferenceAsset {
  key: string
  signedUrl: string
}

interface ReconstructionGenerationControlsProps {
  models: ReconstructionModel[]
  modelKey: string
  onModelChange: (modelKey: string) => void
  durationMode: string
  sourceDurationSec: number
  onDurationChange: (mode: string) => void
  sourceFrameUrl: string
  characterReference: ReconstructionReferenceAsset | null
  sceneReference: ReconstructionReferenceAsset | null
  onReferencePick: (role: 'character' | 'environment', file: File) => Promise<void>
  onRemoveReference: (role: 'character' | 'environment') => void
  targetKeyframe: ReconstructionReferenceAsset | null
  keyframeIsStale: boolean
  keyframeModelLabel: string | null
  onGenerateKeyframe: () => void
  canGenerateKeyframe: boolean
  isGeneratingKeyframe: boolean
  isBusy: boolean
  estimatedUsd: number | null
}

export function ReconstructionGenerationControls(props: ReconstructionGenerationControlsProps) {
  function pickReference(role: 'character' | 'environment', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void props.onReferencePick(role, file)
  }

  return (
    <div className="space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3">
      <div>
        <div className="text-sm font-medium text-white">角色與場景重建</div>
        <p className="mt-1 text-xs leading-5 text-text-tertiary">原影片固定提供完整動作、表情、運鏡、節奏與音樂；新角色圖片只負責人物外觀。</p>
      </div>

      <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-200"><span aria-hidden="true">✓</span> 原始表演已鎖定</div>
        <p className="mt-1.5 text-[11px] leading-5 text-text-tertiary">系統會一直保留原片的舞蹈／肢體動作、表情強度、鏡頭路徑與時間節奏，不需要另外選模式。</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="block text-xs text-text-secondary">模型</span>
          <select
            aria-label="實拍重建模型"
            value={props.modelKey}
            onChange={(event) => props.onModelChange(event.target.value)}
            disabled={props.isBusy || props.models.length === 0}
            className="w-full rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-400/60 disabled:opacity-50"
          >
            {props.models.length === 0 ? <option value="">尚未啟用 R2V 模型</option> : null}
            {props.models.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="block text-xs text-text-secondary">輸出秒數</span>
          <select
            aria-label="實拍重建輸出秒數"
            value={props.durationMode}
            onChange={(event) => props.onDurationChange(event.target.value)}
            disabled={props.isBusy}
            className="w-full rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-400/60 disabled:opacity-50"
          >
            <option value="source" disabled={props.sourceDurationSec < 4}>跟隨原片（{props.sourceDurationSec.toFixed(1)} 秒）{props.sourceDurationSec < 4 ? '— 模型最低 4 秒' : ''}</option>
            {Array.from({ length: 12 }, (_, index) => index + 4).map((seconds) => (
              <option key={seconds} value={String(seconds)}>{seconds} 秒</option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-3 border-t border-white/[0.07] pt-3">
        <div>
          <div className="text-xs font-medium text-white">1. 上傳新角色</div>
          <p className="mt-1 text-[11px] leading-5 text-text-tertiary">必填。建議使用清楚的全身或半身單人照；這張圖只決定新角色的臉、身形、髮型與外觀。</p>
        </div>
        <ReferenceUploadCard
          label="新角色圖片"
          asset={props.characterReference}
          required
          disabled={props.isBusy}
          onPick={(event) => pickReference('character', event)}
          onRemove={() => props.onRemoveReference('character')}
        />

        <div>
          <div className="text-xs font-medium text-white">2. 新場景參考（可選）</div>
          <p className="mt-1 text-[11px] leading-5 text-text-tertiary">不傳圖片時會依照下方的新場景文字建立背景；有明確美術設定圖時再上傳。</p>
        </div>
        <ReferenceUploadCard
          label="新場景圖片"
          asset={props.sceneReference}
          disabled={props.isBusy}
          onPick={(event) => pickReference('environment', event)}
          onRemove={() => props.onRemoveReference('environment')}
        />
      </div>

      <div className="space-y-3 border-t border-white/[0.07] pt-3">
        <div>
          <div className="text-xs font-medium text-white">3. 建立定裝關鍵幀</div>
          <p className="mt-1 text-[11px] leading-5 text-text-tertiary">AI 會以原片畫面的姿勢和構圖為底，先套用新角色、服裝與場景。確認這張畫面正確後，才會生成完整影片。</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <KeyframeTile label="原片動作幀" imageUrl={props.sourceFrameUrl} />
          <KeyframeTile label="定裝關鍵幀" imageUrl={props.targetKeyframe?.signedUrl ?? null} pending={props.isGeneratingKeyframe} />
        </div>
        {props.keyframeIsStale && props.targetKeyframe ? <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">角色、場景或重建設定已變更，請重新建立定裝關鍵幀。</div> : null}
        <button type="button" onClick={props.onGenerateKeyframe} disabled={props.isBusy || props.isGeneratingKeyframe || !props.canGenerateKeyframe} className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-3 py-3 text-xs font-medium text-cyan-200 hover:bg-cyan-400/15 disabled:opacity-40">
          <AppIcon name="sparkles" className="h-4 w-4" />
          {props.isGeneratingKeyframe ? '正在建立定裝關鍵幀…' : props.targetKeyframe ? '重新建立定裝關鍵幀' : '建立定裝關鍵幀'}
        </button>
        <div className="text-[10px] text-text-tertiary">定裝模型：{props.keyframeModelLabel ?? '尚未啟用可接收參考圖的 AtlasCloud 圖片模型'}；此步驟會產生一次圖片生成費用。</div>
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.07] pt-3 text-[11px]">
        <span className="text-text-tertiary">保留原音時必須選擇「跟隨原片」，避免音畫錯位。</span>
        <span className="font-mono text-cyan-300">{props.estimatedUsd === null ? '成本 —' : `預估 US$${props.estimatedUsd.toFixed(4)}`}</span>
      </div>
    </div>
  )
}

function ReferenceUploadCard(props: {
  label: string
  asset: ReconstructionReferenceAsset | null
  required?: boolean
  disabled: boolean
  onPick: (event: ChangeEvent<HTMLInputElement>) => void
  onRemove: () => void
}) {
  return props.asset ? (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.09] bg-black/20 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={props.asset.signedUrl} alt={props.label} className="h-16 w-16 rounded-lg object-cover" />
      <span className="min-w-0 flex-1 text-xs text-white">{props.label}<span className="mt-1 block text-[10px] text-emerald-300">已上傳</span></span>
      <button type="button" onClick={props.onRemove} disabled={props.disabled} className="px-2 text-xs text-text-tertiary hover:text-red-300 disabled:opacity-40">移除</button>
    </div>
  ) : (
    <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs transition ${props.required ? 'border-cyan-400/35 text-cyan-200' : 'border-white/[0.14] text-text-secondary'} hover:border-cyan-400/50`}>
      <AppIcon name="upload" className="h-4 w-4" />
      上傳{props.label}{props.required ? '（必填）' : ''}
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={props.disabled} onChange={props.onPick} className="sr-only" />
    </label>
  )
}

function KeyframeTile(props: { label: string; imageUrl: string | null; pending?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-black/25">
      <div className="aspect-video bg-black/50">
        {props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.imageUrl} alt={props.label} className="h-full w-full object-cover" />
        ) : <div className="flex h-full items-center justify-center px-3 text-center text-[10px] text-text-tertiary">{props.pending ? 'AI 生成中…' : '尚未建立'}</div>}
      </div>
      <div className="px-2 py-1.5 text-[10px] text-text-secondary">{props.label}</div>
    </div>
  )
}

interface ReconstructionPromptReviewProps {
  prompt: string
  isStale: boolean
  isBusy: boolean
  isGenerating: boolean
  onBuild: () => void
  onPromptChange: (prompt: string) => void
  onGenerate: () => void
}

export function ReconstructionPromptReview(props: ReconstructionPromptReviewProps) {
  return (
    <div className="space-y-3 rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">生成前檢查 Prompt</div>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">先產出真正送給模型的 Prompt；確認人物、場景、運鏡與對白綁定後才會扣款生成。</p>
        </div>
        <button type="button" onClick={props.onBuild} disabled={props.isBusy} className="shrink-0 rounded-lg border border-violet-400/30 px-3 py-2 text-xs text-violet-200 hover:bg-violet-400/10 disabled:opacity-40">
          {props.prompt ? '重新產出 Prompt' : '產出 Prompt'}
        </button>
      </div>
      {props.prompt ? (
        <>
          {props.isStale ? <div role="alert" className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">設定已變更，請重新產出 Prompt 後再生成。</div> : null}
          <textarea
            aria-label="實拍重建 Prompt 預覽"
            value={props.prompt}
            onChange={(event) => props.onPromptChange(event.target.value)}
            className="min-h-72 w-full resize-y rounded-xl border border-white/[0.09] bg-black/40 px-3 py-3 font-mono text-xs leading-5 text-text-secondary outline-none focus:border-violet-400/50"
          />
          <div className="flex items-center justify-between text-[11px] text-text-tertiary">
            <span>{props.prompt.length}/6000 字</span>
            <span>可直接修改；送出時保留原文，不會自動壓縮。</span>
          </div>
          <button type="button" onClick={props.onGenerate} disabled={props.isBusy || props.isGenerating || props.isStale || !props.prompt.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-400 px-4 py-3.5 text-sm font-semibold text-black disabled:opacity-40">
            <AppIcon name="sparkles" className="h-4 w-4" />
            {props.isGenerating ? 'Seedance 2.0 重建中…' : '確認 Prompt 並生成影片'}
          </button>
        </>
      ) : null}
    </div>
  )
}
