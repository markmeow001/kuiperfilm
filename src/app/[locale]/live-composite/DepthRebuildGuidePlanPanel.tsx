'use client'

import { useId } from 'react'
import styles from './LiveCompositeShell.module.css'

export type DepthRebuildGuideStrategy = 'full-dual' | 'depth-plus-detail' | 'depth-only'

export interface DepthRebuildGuidePlanPanelProps {
  strategy: DepthRebuildGuideStrategy
  sourceDuration: number
  outputDuration: number
  primaryDuration: number
  secondaryStart: number
  secondaryDuration: number
  totalReferenceDuration: number
  maxReferenceDuration: number
  criticalCenterSeconds: number
  disabled?: boolean
  onCriticalCenterChange: (value: number) => void
}

const STRATEGY_COPY: Readonly<Record<DepthRebuildGuideStrategy, {
  title: string
  summary: string
}>> = {
  'full-dual': {
    title: '完整 Depth＋完整 RGB',
    summary: '完整 Depth 保留全片構圖與走位，再用完整原片補強視線、表情與表演節奏。',
  },
  'depth-plus-detail': {
    title: '完整 Depth＋關鍵 RGB',
    summary: 'Depth 保留全片走位，再用一小段原片加強最重要的表情與互動。',
  },
  'depth-only': {
    title: '只用完整 Depth',
    summary: '只保留全片輪廓、走位與空間，不額外加入 RGB 原片。',
  },
}

function seconds(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

function GuideRow({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t border-white/8 py-3 first:border-t-0">
      <p className="text-sm font-medium text-stone-200">{label}</p>
      <p className="font-mono text-sm tabular-nums text-cyan-200">{value}</p>
      <p className="col-span-2 text-xs leading-5 text-stone-500">{detail}</p>
    </div>
  )
}

export function DepthRebuildGuidePlanPanel({
  strategy,
  sourceDuration,
  outputDuration,
  primaryDuration,
  secondaryStart,
  secondaryDuration,
  totalReferenceDuration,
  maxReferenceDuration,
  criticalCenterSeconds,
  disabled = false,
  onCriticalCenterChange,
}: DepthRebuildGuidePlanPanelProps) {
  const sliderId = useId()
  const copy = STRATEGY_COPY[strategy]
  const referenceOverLimit = totalReferenceDuration > maxReferenceDuration
  const referencePercent = maxReferenceDuration > 0
    ? Math.min(100, Math.max(0, (totalReferenceDuration / maxReferenceDuration) * 100))
    : 100
  const secondaryEnd = secondaryStart + secondaryDuration

  return (
    <section
      aria-labelledby="depth-guide-plan-heading"
      className="overflow-hidden rounded-xl border border-cyan-300/20 bg-[#0c1218]"
    >
      <header className="border-b border-cyan-300/15 bg-cyan-300/[0.045] px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300">Guide plan</p>
          <span className="rounded-full border border-cyan-300/25 bg-cyan-300/[0.07] px-2 py-0.5 text-[10px] font-medium text-cyan-100">
            一次生成
          </span>
        </div>
        <h3 id="depth-guide-plan-heading" className="mt-2 text-base font-semibold text-stone-100">
          {copy.title}
        </h3>
        <p className="mt-1 text-xs leading-5 text-stone-400">{copy.summary}</p>
        <p className="mt-2 text-[11px] leading-4 text-stone-500">
          這是送出時的預計參考配置，不代表本機深度影片已產生。
        </p>
      </header>

      <div className="px-4 py-2">
        <GuideRow
          label="Depth 引導"
          value={`${seconds(primaryDuration)} 秒`}
          detail={`完整涵蓋原片 ${seconds(sourceDuration)} 秒，保留全片走位、輪廓與前後關係。`}
        />
        {strategy === 'full-dual' ? (
          <GuideRow
            label="RGB 全片細節"
            value={`${seconds(secondaryDuration)} 秒`}
            detail="完整原片會送入同一次生成，用來補強表演、視線與節奏；不會取代 Depth 的全片構圖與走位。"
          />
        ) : strategy === 'depth-plus-detail' ? (
          <GuideRow
            label="RGB 關鍵片段"
            value={`${seconds(secondaryDuration)} 秒`}
            detail={`取用原片 ${seconds(secondaryStart)}–${seconds(secondaryEnd)} 秒，加強最重要的動作與表情。`}
          />
        ) : (
          <GuideRow
            label="RGB 原片引導"
            value="不使用"
            detail="這次只送完整 Depth，不占用額外的 RGB 參考秒數。"
          />
        )}
      </div>

      {strategy === 'depth-plus-detail' ? (
        <div className="border-t border-white/10 bg-black/15 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={sliderId} className="text-sm font-medium text-stone-200">
              關鍵動作位置
            </label>
            <output
              htmlFor={sliderId}
              className="font-mono text-sm tabular-nums text-cyan-200"
            >
              {seconds(criticalCenterSeconds)} 秒
            </output>
          </div>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            把游標移到最需要保留表情、互動或快速動作的位置，系統會在附近取一段 RGB 原片。
          </p>
          <label
            htmlFor={sliderId}
            className={`${styles.specialControlHitArea} mt-2 flex items-center`}
            data-live-composite-control-hit-area
          >
            <input
              id={sliderId}
              aria-label="關鍵動作位置"
              type="range"
              min={0}
              max={sourceDuration}
              step={0.1}
              value={criticalCenterSeconds}
              disabled={disabled}
              onChange={(event) => onCriticalCenterChange(Number(event.currentTarget.value))}
              className="h-1.5 w-full cursor-pointer accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
            />
          </label>
          <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-stone-600">
            <span>0 秒</span>
            <span>{seconds(sourceDuration)} 秒</span>
          </div>
        </div>
      ) : null}

      <div className="border-t border-white/10 px-4 py-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-stone-500">參考影片總長</p>
            <p className={`mt-1 font-mono text-base font-semibold tabular-nums ${referenceOverLimit ? 'text-rose-300' : 'text-stone-100'}`}>
              {seconds(totalReferenceDuration)} / {seconds(maxReferenceDuration)} 秒
            </p>
          </div>
          <p className="max-w-48 text-right text-[11px] leading-4 text-stone-500">
            {secondaryDuration > 0
              ? '雙參考會保留 0.5 秒給轉碼與影格誤差'
              : 'Depth 參考不能超過模型上限'}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="參考影片總長"
          aria-valuemin={0}
          aria-valuemax={maxReferenceDuration}
          aria-valuenow={totalReferenceDuration}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8"
        >
          <div
            className={`h-full rounded-full ${referenceOverLimit ? 'bg-rose-400' : 'bg-cyan-300'}`}
            style={{ width: `${referencePercent}%` }}
          />
        </div>
        {referenceOverLimit ? (
          <p role="alert" className="mt-3 rounded-lg border border-rose-300/25 bg-rose-300/[0.06] px-3 py-2 text-xs leading-5 text-rose-200">
            參考影片總長超過 {seconds(maxReferenceDuration)} 秒上限，請縮短關鍵 RGB 片段後再生成。
          </p>
        ) : null}
      </div>

      <p className="border-t border-cyan-300/15 bg-cyan-300/[0.035] px-4 py-3 text-xs leading-5 text-cyan-100/80">
        AI 會先用模型需要的整數片長生成 {seconds(outputDuration)} 秒，再自動裁回原片 {seconds(sourceDuration)} 秒。
      </p>
    </section>
  )
}
