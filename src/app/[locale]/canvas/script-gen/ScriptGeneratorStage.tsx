'use client'

/**
 * 脚本生成器全屏编辑器（LibTV 对标）：① 确认镜头 → ② 准备资产 → ③ 合成提示词。
 * 状态全部住在脚本节点的 data 上（父层传入 mutators），本组件只负责三步
 * 导航与布局；关掉再打开不丢任何东西，序列化随画布保存。
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import type { CanvasGenerationValue } from '../lib/canvas-generation'
import type { CanvasScriptAsset, CanvasStoryboardShot } from '../lib/canvas-types'
import { AssetBoard } from './AssetBoard'
import { BatchAssetDialog } from './BatchAssetDialog'
import { ShotTable } from './ShotTable'
import type { ScriptGenProgress } from './script-gen-lib'

export type ScriptGenStep = 1 | 2 | 3

export interface ScriptGeneratorStageProps {
  shots: readonly CanvasStoryboardShot[]
  assets: readonly CanvasScriptAsset[]
  globalStyle: string
  progress: ScriptGenProgress
  gen: CanvasGenerationValue
  imageModelKey: string
  initialStep: ScriptGenStep
  synthesizing: boolean
  synthError: string | null
  onClose: () => void
  onEditShot: (index: number, patch: Partial<CanvasStoryboardShot>) => void
  onDeleteShot: (index: number) => void
  onMoveShot: (index: number, dir: -1 | 1) => void
  onAddShot: () => void
  onSetGlobalStyle: (value: string) => void
  onEditAsset: (id: string, patch: Partial<CanvasScriptAsset>) => void
  onAddAsset: (asset: CanvasScriptAsset) => void
  onDeleteAsset: (id: string) => void
  onSynthesizeAll: () => void
}

export function ScriptGeneratorStage(props: ScriptGeneratorStageProps) {
  const [step, setStep] = useState<ScriptGenStep>(props.initialStep)
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const { progress } = props

  const stepMeta: Array<{ step: ScriptGenStep; title: string; subtitle: string }> = [
    {
      step: 1,
      title: '确认镜头',
      subtitle: progress.shotsTotal === 0
        ? '暂无镜头'
        : progress.shotsReady === progress.shotsTotal
          ? `${progress.shotsTotal}个镜头已就绪`
          : `${progress.shotsTotal - progress.shotsReady}个镜头待核对`,
    },
    {
      step: 2,
      title: '准备资产',
      subtitle: progress.assetsTotal === 0
        ? '暂无资产'
        : `${progress.assetsDone}/${progress.assetsTotal} 已生成、还差 ${progress.assetsTotal - progress.assetsDone} 个`,
    },
    {
      step: 3,
      title: '合成提示词',
      subtitle: `${progress.promptsDone}/${Math.max(progress.shotsTotal, 1)} 已合成`,
    },
  ]

  const missingAssets = props.assets.filter((asset) => !asset.imageKey && !asset.runId)

  const body = (
    <div className="fixed inset-0 z-[60] flex flex-col p-4" style={{ background: CANVAS_TOKENS.bg.canvas, color: CANVAS_TOKENS.text.primary }}>
      {/* header — 三步导航 */}
      <div className="relative mb-3 flex shrink-0 items-center justify-center gap-2">
        {stepMeta.map((meta, i) => (
          <div key={meta.step} className="flex items-center gap-2">
            {i > 0 ? <span className="h-px w-24" style={{ background: CANVAS_TOKENS.hairline }} /> : null}
            <button
              type="button"
              onClick={() => setStep(meta.step)}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left"
              style={step === meta.step ? { background: CANVAS_TOKENS.bg.popover } : undefined}
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-[13px]"
                style={{
                  border: `1.5px solid ${step === meta.step ? CANVAS_TOKENS.text.primary : CANVAS_TOKENS.hairline}`,
                  color: step === meta.step ? CANVAS_TOKENS.text.primary : CANVAS_TOKENS.text.muted,
                }}
              >
                {meta.step}
              </span>
              <span>
                <span className="block text-[13px]" style={{ color: step === meta.step ? CANVAS_TOKENS.text.primary : CANVAS_TOKENS.text.secondary }}>
                  {meta.title}
                </span>
                <span className="block text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>{meta.subtitle}</span>
              </span>
            </button>
          </div>
        ))}
        <div className="absolute right-0 top-1 flex items-center gap-3 text-[12px]" style={{ color: CANVAS_TOKENS.text.muted }}>
          <span>{progress.completeSteps}/3 完成后可批量生视频</span>
          <button type="button" onClick={props.onClose} aria-label="关闭" className="text-[16px]">✕</button>
        </div>
      </div>

      {/* step content */}
      <div className="min-h-0 flex-1">
        {step === 2 ? (
          <AssetBoard
            assets={props.assets}
            globalStyle={props.globalStyle}
            gen={props.gen}
            imageModelKey={props.imageModelKey}
            onSetGlobalStyle={props.onSetGlobalStyle}
            onEditAsset={props.onEditAsset}
            onAddAsset={props.onAddAsset}
            onDeleteAsset={props.onDeleteAsset}
            onOpenBatchDialog={() => setBatchDialogOpen(true)}
          />
        ) : (
          <ShotTable
            shots={props.shots}
            assetNames={props.assets.map((asset) => asset.name)}
            focusFinal={step === 3}
            onEditShot={props.onEditShot}
            onDeleteShot={props.onDeleteShot}
            onMoveShot={props.onMoveShot}
            onAddShot={props.onAddShot}
          />
        )}
      </div>

      {/* footer — 每步的主动作 */}
      <div className="mt-3 flex shrink-0 items-center justify-end gap-3">
        {props.synthError ? <span className="text-[12px]" style={{ color: '#FF8A8A' }}>{props.synthError}</span> : null}
        {step === 1 ? (
          <button
            type="button"
            onClick={() => setStep(2)}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold"
            style={{ background: '#FFFFFF', color: '#111' }}
          >
            → 下一步：准备资产
          </button>
        ) : step === 2 ? (
          <button
            type="button"
            onClick={() => setStep(3)}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold"
            style={{ background: '#FFFFFF', color: '#111' }}
          >
            → 下一步：合成提示词
          </button>
        ) : (
          <button
            type="button"
            onClick={props.onSynthesizeAll}
            disabled={props.synthesizing || progress.shotsTotal === 0 || progress.shotsReady !== progress.shotsTotal}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
            style={{ background: '#FFFFFF', color: '#111' }}
          >
            {props.synthesizing ? '合成中…' : '一键合成全部提示词'}
          </button>
        )}
      </div>

      {batchDialogOpen ? (
        <BatchAssetDialog
          assets={missingAssets}
          globalStyle={props.globalStyle}
          gen={props.gen}
          defaultModelKey={props.imageModelKey}
          onEditAsset={props.onEditAsset}
          onClose={() => setBatchDialogOpen(false)}
        />
      ) : null}
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(body, document.body)
}
