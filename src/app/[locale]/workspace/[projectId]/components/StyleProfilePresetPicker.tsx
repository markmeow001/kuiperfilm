'use client'

/**
 * Phase 11.5 — Preset picker UI for StyleProfilePanel.
 *
 * 4 个 preset 按钮：realistic / american-comic / anime / thick-paint。
 * 点击后回调把 preset 的 positivePrompt + negativePrompt 填进上层 textarea。
 */

import {
  STYLE_PROFILE_PRESETS,
  type PresetKey,
  type StylePresetEntry,
} from '@/lib/style-profile/presets'

interface StyleProfilePresetPickerProps {
  onSelect: (preset: StylePresetEntry & { key: PresetKey }) => void
  disabled?: boolean
}

const PRESET_ORDER: PresetKey[] = ['realistic', 'american-comic', 'anime', 'thick-paint']

const PRESET_LABEL_ZH: Record<PresetKey, string> = {
  'realistic': '真人寫實',
  'american-comic': '美漫風格',
  'anime': '日系動漫',
  'thick-paint': '厚塗油畫',
}

export function StyleProfilePresetPicker({ onSelect, disabled = false }: StyleProfilePresetPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {PRESET_ORDER.map((key) => {
        const entry = STYLE_PROFILE_PRESETS[key]
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect({ key, ...entry })}
            className="group relative flex flex-col gap-2 overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4 text-left text-sm shadow-[var(--glass-shadow-sm)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--glass-stroke-focus)] hover:shadow-[var(--glass-shadow-md)] hover:ring-2 hover:ring-[var(--glass-focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-base font-semibold text-[var(--glass-text-primary)]">{PRESET_LABEL_ZH[key]}</span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--glass-text-tertiary)]">{entry.label}</span>
            </div>
            <div className="line-clamp-3 text-xs leading-relaxed text-[var(--glass-text-secondary)]">{entry.positivePrompt}</div>
          </button>
        )
      })}
    </div>
  )
}
