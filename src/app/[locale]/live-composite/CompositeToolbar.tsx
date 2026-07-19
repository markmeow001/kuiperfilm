'use client'

import { AppIcon } from '@/components/ui/icons'
import type { CompositeView, MaskEditTarget, MaskTool } from './live-composite-types'

interface CompositeToolbarProps {
  tool: MaskTool
  editTarget: MaskEditTarget
  view: CompositeView
  brushPercent: number
  overlayVisible: boolean
  canUndo: boolean
  canRedo: boolean
  currentTime: number
  disabled?: boolean
  onToolChange: (tool: MaskTool) => void
  onEditTargetChange: (target: MaskEditTarget) => void
  onViewChange: (view: CompositeView) => void
  onBrushPercentChange: (value: number) => void
  onOverlayVisibleChange: (visible: boolean) => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
}

const toolButtonClass = (active: boolean): string => `flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors ${active ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200' : 'border-white/10 bg-white/[0.03] text-stone-400 hover:bg-white/[0.07] hover:text-stone-100'}`

export function CompositeToolbar({ tool, editTarget, view, brushPercent, overlayVisible, canUndo, canRedo, currentTime, disabled = false, onToolChange, onEditTargetChange, onViewChange, onBrushPercentChange, onOverlayVisibleChange, onUndo, onRedo, onClear }: CompositeToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-stone-950/90 px-4 py-2.5">
      <div className="mr-1 hidden min-w-40 xl:block">
        <div className="text-[10px] uppercase tracking-[0.16em] text-stone-600">目前正在修正</div>
        <div className="mt-0.5 text-xs text-stone-300">
          {editTarget === 'person' ? '人物去背邊緣' : '前景遮擋區域'} · {currentTime.toFixed(2)}s
        </div>
      </div>
      <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-1">
        <button type="button" disabled={disabled} onClick={() => onEditTargetChange('person')} className={toolButtonClass(editTarget === 'person')}>
          人物修邊
        </button>
        <button type="button" disabled={disabled} onClick={() => onEditTargetChange('occlusion')} className={toolButtonClass(editTarget === 'occlusion')}>
          進階：前景遮擋
        </button>
      </div>
      <button type="button" disabled={disabled} className={toolButtonClass(tool === 'keep')} onClick={() => onToolChange('keep')}>
        <AppIcon name="brush" className="h-4 w-4" />
        {editTarget === 'occlusion' ? '補上遮擋' : '補回人物'}
      </button>
      <button type="button" disabled={disabled} className={toolButtonClass(tool === 'erase')} onClick={() => onToolChange('erase')}>
        <AppIcon name="eraser" className="h-4 w-4" />
        {editTarget === 'occlusion' ? '擦除遮擋' : '擦除錯選'}
      </button>

      <label className="ml-1 flex items-center gap-2 text-xs text-stone-500">
        筆刷
        <input aria-label="筆刷大小" type="range" min={1} max={20} value={brushPercent} disabled={disabled} onChange={(event) => onBrushPercentChange(Number(event.target.value))} className="w-24 accent-cyan-400" />
        <span className="w-8 font-mono text-stone-300">{brushPercent}%</span>
      </label>

      <div className="mx-1 h-6 w-px bg-white/10" />
      <button type="button" aria-label="復原遮罩" disabled={disabled || !canUndo} onClick={onUndo} className="rounded-md p-2 text-stone-400 hover:bg-white/10 hover:text-white disabled:opacity-30">
        <AppIcon name="undo" className="h-4 w-4" />
      </button>
      <button type="button" aria-label="重做遮罩" disabled={disabled || !canRedo} onClick={onRedo} className="rounded-md p-2 text-stone-400 hover:bg-white/10 hover:text-white disabled:opacity-30">
        <AppIcon name="redo" className="h-4 w-4" />
      </button>
      <button type="button" aria-label="清除全部遮罩" disabled={disabled || !canUndo} onClick={onClear} className="rounded-md p-2 text-stone-400 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-30">
        <AppIcon name="trash" className="h-4 w-4" />
      </button>

      <div className="ml-auto flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
        <button type="button" disabled={disabled} title="查看原始影片" aria-label="1. 查看原始影片" onClick={() => onViewChange('source')} className={toolButtonClass(view === 'source')}>
          <AppIcon name="eye" className="h-4 w-4" />
          <span className="hidden 2xl:inline">1 原影片</span>
        </button>
        <button type="button" disabled={disabled} title="檢查人物去背" aria-label="2. 檢查人物去背" onClick={() => onViewChange('mask')} className={toolButtonClass(view === 'mask')}>
          <AppIcon name="scanLine" className="h-4 w-4" />
          <span className="hidden 2xl:inline">2 檢查去背</span>
        </button>
        <button type="button" disabled={disabled} title="預覽合成結果" aria-label="3. 預覽合成結果" onClick={() => onViewChange('composite')} className={toolButtonClass(view === 'composite')}>
          <AppIcon name="image" className="h-4 w-4" />
          <span className="hidden 2xl:inline">3 合成預覽</span>
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-stone-400">
        <input type="checkbox" checked={overlayVisible} disabled={disabled} onChange={(event) => onOverlayVisibleChange(event.target.checked)} className="accent-rose-500" />
        顯示選區
      </label>
    </div>
  )
}
