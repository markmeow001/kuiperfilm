'use client'

/**
 * Vec3Field — labelled X/Y/Z number inputs (LibTV camera-inspector style).
 * Used by the 导演台 camera panel for precise position / look-at coordinates.
 */
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import type { Vec3 } from './stage-types'

interface Vec3FieldProps {
  label: string
  value: Vec3
  step?: number
  onChange: (value: Vec3) => void
}

const AXES = ['X', 'Y', 'Z'] as const

export function Vec3Field({ label, value, step = 0.1, onChange }: Vec3FieldProps) {
  const set = (axis: 0 | 1 | 2, v: number) => {
    const next: Vec3 = [...value]
    next[axis] = Number.isFinite(v) ? v : 0
    onChange(next)
  }
  return (
    <div className="py-0.5">
      <div className="mb-0.5 px-0.5 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{label}</div>
      <div className="flex gap-1">
        {AXES.map((ax, i) => (
          <label key={ax} className="flex flex-1 items-center gap-1 rounded px-1" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            <span className="text-[9px]" style={{ color: CANVAS_TOKENS.text.muted }}>{ax}</span>
            <input
              type="number"
              step={step}
              value={Math.round(value[i] * 100) / 100}
              onChange={(e) => set(i as 0 | 1 | 2, Number(e.target.value))}
              className="w-full bg-transparent py-1 text-[11px] outline-none"
              style={{ color: CANVAS_TOKENS.text.primary }}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
