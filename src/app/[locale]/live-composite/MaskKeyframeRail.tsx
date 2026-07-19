'use client'

import { AppIcon } from '@/components/ui/icons'
import type { MaskKeyframe } from './live-composite-types'

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

export function MaskKeyframeRail({
  duration,
  currentTime,
  keyframes,
  activeKeyframeId,
  hasExactKeyframe,
  disabled = false,
  onAdd,
  onDelete,
  onApplyToStart,
  onApplyToEnd,
  onSeek,
}: MaskKeyframeRailProps) {
  const safeDuration = Math.max(duration, 0.01)
  return (
    <div className="border-t border-white/10 bg-stone-950 px-5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-stone-300">遮罩關鍵影格</span>
          <span className="ml-2 text-[11px] text-stone-600">AI 遮罩平滑過渡；畫筆修正保持到下一關鍵影格</span>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={disabled} onClick={onApplyToStart} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-stone-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-30">
            套用到片頭
          </button>
          <button type="button" disabled={disabled} onClick={onApplyToEnd} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-stone-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-30">
            套用到片尾
          </button>
          <button type="button" disabled={disabled || hasExactKeyframe} onClick={onAdd} className="flex items-center gap-1.5 rounded-md border border-cyan-400/30 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-30">
            <AppIcon name="plus" className="h-3.5 w-3.5" />複製目前遮罩到 {currentTime.toFixed(2)}s
          </button>
          <button type="button" disabled={disabled || !hasExactKeyframe || keyframes.length <= 1} onClick={onDelete} className="flex items-center gap-1.5 rounded-md border border-red-400/20 px-2.5 py-1 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-30">
            <AppIcon name="trash" className="h-3.5 w-3.5" />刪除
          </button>
        </div>
      </div>
      <div className="relative h-8 rounded-md border border-white/10 bg-black/50">
        <div className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${Math.min(100, (currentTime / safeDuration) * 100)}%` }} />
        {keyframes.map((keyframe) => (
          <button
            key={keyframe.id}
            type="button"
            disabled={disabled}
            aria-label={`前往遮罩關鍵影格 ${keyframe.time.toFixed(2)} 秒`}
            title={`${keyframe.time.toFixed(2)}s · ${keyframe.strokes.length} 筆`}
            onClick={() => onSeek(keyframe.time)}
            className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border ${
              keyframe.id === activeKeyframeId
                ? 'border-cyan-200 bg-cyan-400'
                : 'border-stone-500 bg-stone-700 hover:bg-stone-500'
            }`}
            style={{ left: `${Math.min(100, (keyframe.time / safeDuration) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  )
}
