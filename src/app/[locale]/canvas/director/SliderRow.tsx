'use client'

/**
 * SliderRow — LibTV uiux-spec core component (label · thin track w/ cyan fill ·
 * value box). Reused by the 导演台 rig panel (one per joint axis) and any future
 * numeric control. accentColor gives the native range its cyan fill+thumb
 * reliably across browsers without bespoke track CSS.
 */
import { CANVAS_TOKENS } from '../lib/canvas-tokens'

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}

export function SliderRow({ label, value, min, max, step = 1, unit = '°', onChange }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-16 shrink-0 truncate text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
        style={{ accentColor: CANVAS_TOKENS.accent, height: 3 }}
      />
      <span className="w-9 shrink-0 text-right font-mono text-[10px]" style={{ color: CANVAS_TOKENS.accent }}>
        {Math.round(value)}{unit}
      </span>
    </div>
  )
}
