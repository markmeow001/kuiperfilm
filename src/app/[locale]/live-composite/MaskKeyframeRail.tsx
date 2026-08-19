'use client'

import { AppIcon } from '@/components/ui/icons'
import type { MaskKeyframe } from './live-composite-types'
import styles from './LiveCompositeShell.module.css'

interface MaskKeyframeRailProps {
  duration: number
  currentTime: number
  keyframes: MaskKeyframe[]
  activeKeyframeId: string | null
  hasExactKeyframe: boolean
  disabled?: boolean
  onAdd: () => void
  onDelete: () => void
  onApplyToStart: () => void
  onApplyToEnd: () => void
  onSeek: (time: number) => void
}

export function MaskKeyframeRail({ duration, currentTime, keyframes, activeKeyframeId, hasExactKeyframe, disabled = false, onAdd, onDelete, onApplyToStart, onApplyToEnd, onSeek }: MaskKeyframeRailProps) {
  const safeDuration = Math.max(duration, 0.01)
  return (
    <details className={`${styles.keyframeRail} group`}>
      <summary className={styles.keyframeSummary}>
        <span>
          <span className="font-medium text-stone-300">進階：時間遮罩修正</span>
          <span className="ml-2 text-stone-600">{keyframes.length} 個修正位置</span>
        </span>
        <span className="text-[11px] text-stone-600 group-open:hidden">需要分段修正時再展開 ▾</span>
        <span className="hidden text-[11px] text-stone-600 group-open:inline">收合 ▴</span>
      </summary>
      <div className="border-t border-[var(--darkroom-border)] px-3 pb-3 pt-3 sm:px-5">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-xs font-medium text-stone-300">不同時間點的去背修正</span>
            <span className="ml-2 text-[11px] text-stone-600">只有某一段邊緣不準時，才需要新增修正位置</span>
          </div>
          <div className={styles.keyframeActions} data-live-composite-keyframe-actions>
            <button type="button" disabled={disabled} onClick={onApplyToStart} className={styles.keyframeAction}>
              從這裡套用到片頭
            </button>
            <button type="button" disabled={disabled} onClick={onApplyToEnd} className={styles.keyframeAction}>
              從這裡套用到片尾
            </button>
            <button type="button" disabled={disabled || hasExactKeyframe} onClick={onAdd} className={`${styles.keyframeAction} !border-cyan-400/30 !text-cyan-300 hover:!bg-cyan-400/10`}>
              <AppIcon name="plus" className="h-3.5 w-3.5" />在 {currentTime.toFixed(2)}s 建立修正
            </button>
            <button type="button" disabled={disabled || !hasExactKeyframe || keyframes.length <= 1} onClick={onDelete} className={`${styles.keyframeAction} !border-red-400/20 !text-red-300 hover:!bg-red-400/10`}>
              <AppIcon name="trash" className="h-3.5 w-3.5" />
              刪除
            </button>
          </div>
        </div>
        <div className="relative h-11 rounded-md border border-[var(--darkroom-border)] bg-[var(--darkroom-inset)]">
          <div
            className="absolute inset-y-0 w-px bg-white/70"
            style={{
              left: `${Math.min(100, (currentTime / safeDuration) * 100)}%`,
            }}
          />
          {keyframes.map((keyframe) => (
            <button
              key={keyframe.id}
              type="button"
              disabled={disabled}
              aria-label={`前往遮罩關鍵影格 ${keyframe.time.toFixed(2)} 秒`}
              title={`${keyframe.time.toFixed(2)}s · ${keyframe.strokes.length} 筆`}
              onClick={() => onSeek(keyframe.time)}
              className={`${styles.keyframeMarker} ${keyframe.id === activeKeyframeId ? styles.keyframeMarkerActive : ''}`.trim()}
              style={{
                left: `${Math.min(100, (keyframe.time / safeDuration) * 100)}%`,
              }}
            />
          ))}
        </div>
      </div>
    </details>
  )
}
