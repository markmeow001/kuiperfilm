'use client'

import { AppIcon } from '@/components/ui/icons'
import type { CompositeView, MaskEditTarget, MaskTool } from './live-composite-types'
import styles from './LiveCompositeShell.module.css'

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

const toolButtonClass = (active: boolean): string =>
  `${styles.toolbarButton} ${active ? styles.toolbarButtonActive : ''}`.trim()

export function CompositeToolbar({ tool, editTarget, view, brushPercent, overlayVisible, canUndo, canRedo, currentTime, disabled = false, onToolChange, onEditTargetChange, onViewChange, onBrushPercentChange, onOverlayVisibleChange, onUndo, onRedo, onClear }: CompositeToolbarProps) {
  return (
    <div className={styles.toolbar} data-live-composite-toolbar>
      <div className="mr-1 hidden min-w-40 xl:block">
        <div className="text-[10px] uppercase tracking-[0.16em] text-stone-600">目前正在修正</div>
        <div className="mt-0.5 text-xs text-stone-300">
          {editTarget === 'person' ? '人物去背邊緣' : '前景遮擋區域'} · {currentTime.toFixed(2)}s
        </div>
      </div>
      <div
        className={styles.toolbarScroll}
        data-live-composite-toolbar-scroll
      >
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

      <label
        className={`${styles.specialControlHitArea} ml-1 flex items-center gap-2 text-xs text-stone-500`}
        data-live-composite-control-hit-area
      >
        筆刷
        <input aria-label="筆刷大小" type="range" min={1} max={20} value={brushPercent} disabled={disabled} onChange={(event) => onBrushPercentChange(Number(event.target.value))} className="w-24 accent-cyan-400" />
        <span className="w-8 font-mono text-stone-300">{brushPercent}%</span>
      </label>

      <div className="mx-1 h-6 w-px bg-white/10" />
      <button type="button" aria-label="復原遮罩" disabled={disabled || !canUndo} onClick={onUndo} className={styles.toolbarIconButton}>
        <AppIcon name="undo" className="h-4 w-4" />
      </button>
      <button type="button" aria-label="重做遮罩" disabled={disabled || !canRedo} onClick={onRedo} className={styles.toolbarIconButton}>
        <AppIcon name="redo" className="h-4 w-4" />
      </button>
      <button type="button" aria-label="清除全部遮罩" disabled={disabled || !canUndo} onClick={onClear} className={`${styles.toolbarIconButton} hover:!bg-red-400/10 hover:!text-red-300`}>
        <AppIcon name="trash" className="h-4 w-4" />
      </button>

      <div className={`${styles.toolbarScroll} ml-auto`}>
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
      <label
        className={`${styles.specialControlHitArea} flex items-center gap-2 text-xs text-stone-400`}
        data-live-composite-control-hit-area
      >
        <input type="checkbox" checked={overlayVisible} disabled={disabled} onChange={(event) => onOverlayVisibleChange(event.target.checked)} className="h-5 w-5 accent-cyan-400" />
        顯示選區
      </label>
    </div>
  )
}
