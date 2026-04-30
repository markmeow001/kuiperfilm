'use client'

/**
 * Phase 11.5 — Preset picker UI for StyleProfilePanel.
 *
 * 22 active presets grouped into 6 categories. Each card shows the
 * Chinese label, an English caption, and a multi-line description so
 * the user can pick a style without reading the full prompt.
 */

import {
  STYLE_PROFILE_PRESETS,
  PRESET_ORDER_BY_CATEGORY,
  CATEGORY_LABEL_ZH,
  type PresetKey,
  type PresetCategory,
  type StylePresetEntry,
} from '@/lib/style-profile/presets'

interface StyleProfilePresetPickerProps {
  onSelect: (preset: StylePresetEntry & { key: PresetKey }) => void
  disabled?: boolean
}

const CATEGORY_ORDER: PresetCategory[] = ['realistic', 'anime', 'chinese', 'korean', 'cg-3d', 'western']

export function StyleProfilePresetPicker({ onSelect, disabled = false }: StyleProfilePresetPickerProps) {
  return (
    <div className="space-y-6">
      {CATEGORY_ORDER.map((category) => {
        const keys = PRESET_ORDER_BY_CATEGORY[category]
        if (!keys || keys.length === 0) return null
        return (
          <section key={category}>
            <h5 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--glass-text-tertiary)]">
              {CATEGORY_LABEL_ZH[category]}
            </h5>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {keys.map((key) => {
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
                      <span className="text-base font-semibold text-[var(--glass-text-primary)]">{entry.zhLabel}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--glass-text-tertiary)]">{entry.label}</span>
                    </div>
                    <div className="text-xs leading-relaxed text-[var(--glass-text-secondary)]">{entry.zhDescription}</div>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
