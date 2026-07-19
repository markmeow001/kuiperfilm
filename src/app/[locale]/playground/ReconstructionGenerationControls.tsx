'use client'

import type { ChangeEvent, RefObject } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { ReconstructionReferenceRole, ReconstructionStrategy } from '@/lib/playground/reconstruction-contract'
import type { PlaygroundController } from './usePlaygroundController'

type ReconstructionModel = PlaygroundController['videoModels'][number]
type ReferenceImage = PlaygroundController['refImages'][number]

const ROLE_OPTIONS: Array<{ value: ReconstructionReferenceRole; label: string }> = [
  { value: 'character', label: '人物外觀' },
  { value: 'keyframe', label: '目標關鍵幀' },
]

const STRATEGY_OPTIONS: Array<{
  value: ReconstructionStrategy
  label: string
  badge: string
  description: string
}> = [
  {
    value: 'motion-first',
    label: '動作優先',
    badge: '最穩定',
    description: '只送原影片，不送圖片。最能保留舞蹈、表情、運鏡、節奏與背景音樂；人物外觀以文字改造。',
  },
  {
    value: 'identity-first',
    label: '人物外觀參考',
    badge: '實驗性',
    description: '原影片加一張人物圖。圖片只作外觀參考，但模型仍可能改變動作、構圖或人物身份。',
  },
  {
    value: 'keyframe-guided',
    label: '高一致性',
    badge: '需目標幀',
    description: '上傳一張已換好人物、服裝與場景，且姿勢和構圖貼近原片的目標關鍵幀，再由原影片驅動動作。',
  },
]

interface ReconstructionGenerationControlsProps {
  models: ReconstructionModel[]
  strategy: ReconstructionStrategy
  onStrategyChange: (strategy: ReconstructionStrategy) => void
  modelKey: string
  onModelChange: (modelKey: string) => void
  durationMode: string
  sourceDurationSec: number
  onDurationChange: (mode: string) => void
  refImages: ReferenceImage[]
  refImagesCap: number
  referenceRoles: Record<string, ReconstructionReferenceRole>
  onRoleChange: (key: string, role: ReconstructionReferenceRole) => void
  onNameChange: (key: string, name: string) => void
  onRemoveImage: (index: number) => void
  imageInputRef: RefObject<HTMLInputElement | null>
  onImagePick: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  isBusy: boolean
  estimatedUsd: number | null
}

export function ReconstructionGenerationControls(props: ReconstructionGenerationControlsProps) {
  const acceptsReferenceImage = props.strategy !== 'motion-first'
  const referenceTitle = props.strategy === 'keyframe-guided' ? '目標關鍵幀' : '人物外觀參考圖'
  const referenceHelp = props.strategy === 'keyframe-guided'
    ? '不是一般人物照：畫面需包含目標人物、服裝與場景，姿勢和鏡頭構圖要貼近原片。'
    : 'Seedance 沒有 API 級人物硬綁定；名稱只會作為 Prompt 的語義對應。建議使用全身、自然站姿、角度接近原片的單人照片。'
  const expectedRole: ReconstructionReferenceRole = props.strategy === 'keyframe-guided' ? 'keyframe' : 'character'

  return (
    <div className="space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3">
      <div>
        <div className="text-sm font-medium text-white">生成控制</div>
        <p className="mt-1 text-xs leading-5 text-text-tertiary">只顯示可接收表演影片的 AtlasCloud Seedance 2.0 R2V 模型。</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs text-text-secondary">重建策略</legend>
        <div className="grid gap-2">
          {STRATEGY_OPTIONS.map((option) => {
            const selected = props.strategy === option.value
            return (
              <label key={option.value} className={`cursor-pointer rounded-xl border p-3 transition ${selected ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/[0.08] bg-black/20 hover:border-white/20'}`}>
                <input
                  type="radio"
                  name="reconstruction-strategy"
                  value={option.value}
                  checked={selected}
                  disabled={props.isBusy}
                  onChange={() => props.onStrategyChange(option.value)}
                  className="sr-only"
                />
                <span className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-medium ${selected ? 'text-cyan-200' : 'text-white'}`}>{option.label}</span>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-text-tertiary">{option.badge}</span>
                </span>
                <span className="mt-1.5 block text-[11px] leading-5 text-text-tertiary">{option.description}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

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

      <div className="flex items-center justify-between border-t border-white/[0.07] pt-3">
        <div>
          <div className="text-xs font-medium text-white">{referenceTitle}</div>
          <div className="mt-1 text-[11px] leading-5 text-text-tertiary">{acceptsReferenceImage ? referenceHelp : '動作優先不會把任何參考圖送給模型，避免圖片蓋過原片的舞蹈與運鏡。'}</div>
        </div>
        <span className="font-mono text-[11px] text-cyan-300">{props.refImages.length}/{props.refImagesCap}</span>
      </div>

      <input
        ref={props.imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => void props.onImagePick(event)}
      />
      <button
        type="button"
        onClick={() => props.imageInputRef.current?.click()}
        disabled={props.isBusy || !acceptsReferenceImage || props.refImages.length >= props.refImagesCap}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.14] px-3 py-3 text-xs text-text-secondary hover:border-cyan-400/40 hover:text-cyan-200 disabled:opacity-40"
      >
        <AppIcon name="upload" className="h-4 w-4" />
        {props.strategy === 'keyframe-guided' ? '上傳目標關鍵幀' : '上傳一張人物外觀參考圖'}
      </button>

      {props.refImages.length > 0 ? (
        <div className="space-y-2">
          {props.refImages.map((reference, index) => (
            <div key={reference.key} className="grid grid-cols-[52px_104px_1fr_auto] items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={reference.signedUrl} alt={`參考圖片 ${index + 1}`} className="h-12 w-12 rounded-lg object-cover" />
              <select
                aria-label={`參考圖片 ${index + 1} 用途`}
                value={props.referenceRoles[reference.key] ?? expectedRole}
                onChange={(event) => props.onRoleChange(reference.key, event.target.value as ReconstructionReferenceRole)}
                disabled={props.isBusy}
                className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-white"
              >
                {ROLE_OPTIONS.filter((role) => role.value === expectedRole).map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
              <input
                aria-label={`參考圖片 ${index + 1} 名稱`}
                value={reference.name ?? ''}
                onChange={(event) => props.onNameChange(reference.key, event.target.value)}
                disabled={props.isBusy}
                maxLength={80}
                placeholder={props.strategy === 'keyframe-guided' ? '例如：民國街道目標幀' : '例如：女主角外觀'}
                className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs text-white outline-none placeholder:text-text-tertiary/70 focus:border-cyan-400/50"
              />
              <button type="button" aria-label={`移除參考圖片 ${index + 1}`} onClick={() => props.onRemoveImage(index)} disabled={props.isBusy} className="px-1 text-text-tertiary hover:text-red-300">×</button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-white/[0.07] pt-3 text-[11px]">
        <span className="text-text-tertiary">保留原音時必須選擇「跟隨原片」，避免音畫錯位。</span>
        <span className="font-mono text-cyan-300">{props.estimatedUsd === null ? '成本 —' : `預估 US$${props.estimatedUsd.toFixed(4)}`}</span>
      </div>
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
