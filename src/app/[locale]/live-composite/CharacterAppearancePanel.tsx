'use client'

import { DEFAULT_CHARACTER_APPEARANCE } from './lib/character-appearance'
import type { VirtualCharacterAppearance } from './live-composite-types'

interface CharacterAppearancePanelProps {
  value?: VirtualCharacterAppearance
  disabled: boolean
  onChange: (value: VirtualCharacterAppearance) => void
  onAutoMatch: () => void
}

interface ControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (value: number) => void
}

function Control({ label, value, min, max, step, disabled, onChange }: ControlProps) {
  return <label className="block text-[11px] text-stone-500"><span className="mb-1 flex justify-between"><span>{label}</span><span className="font-mono text-stone-300">{value.toFixed(step < 1 ? 2 : 0)}</span></span><input aria-label={label} type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-cyan-400" /></label>
}

export function CharacterAppearancePanel({ value, disabled, onChange, onAutoMatch }: CharacterAppearancePanelProps) {
  const appearance = value ?? DEFAULT_CHARACTER_APPEARANCE
  const patch = (next: Partial<VirtualCharacterAppearance>) => onChange({ ...appearance, ...next })
  return (
    <details className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.03] p-3">
      <summary className="cursor-pointer text-xs font-medium text-cyan-200">光影與畫面匹配</summary>
      <div className="mt-3 space-y-3">
        <button type="button" disabled={disabled} onClick={onAutoMatch} className="w-full rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">依目前實拍影格自動匹配</button>
        <div className="grid grid-cols-2 gap-3">
          <Control label="曝光" value={appearance.exposure} min={-1} max={1} step={0.01} disabled={disabled} onChange={(exposure) => patch({ exposure })} />
          <Control label="對比" value={appearance.contrast} min={-1} max={1} step={0.01} disabled={disabled} onChange={(contrast) => patch({ contrast })} />
          <Control label="飽和度" value={appearance.saturation} min={-1} max={1} step={0.01} disabled={disabled} onChange={(saturation) => patch({ saturation })} />
          <Control label="色溫" value={appearance.temperature} min={-1} max={1} step={0.01} disabled={disabled} onChange={(temperature) => patch({ temperature })} />
          <Control label="柔焦 px" value={appearance.blur} min={0} max={12} step={0.5} disabled={disabled} onChange={(blur) => patch({ blur })} />
          <Control label="邊緣融光" value={appearance.lightWrap} min={0} max={1} step={0.01} disabled={disabled} onChange={(lightWrap) => patch({ lightWrap })} />
          <Control label="陰影濃度" value={appearance.shadowOpacity} min={0} max={1} step={0.01} disabled={disabled} onChange={(shadowOpacity) => patch({ shadowOpacity })} />
          <Control label="陰影模糊" value={appearance.shadowBlur} min={0} max={80} step={1} disabled={disabled} onChange={(shadowBlur) => patch({ shadowBlur })} />
          <Control label="陰影 X" value={appearance.shadowOffsetX} min={-80} max={80} step={1} disabled={disabled} onChange={(shadowOffsetX) => patch({ shadowOffsetX })} />
          <Control label="陰影 Y" value={appearance.shadowOffsetY} min={-80} max={80} step={1} disabled={disabled} onChange={(shadowOffsetY) => patch({ shadowOffsetY })} />
        </div>
      </div>
    </details>
  )
}
