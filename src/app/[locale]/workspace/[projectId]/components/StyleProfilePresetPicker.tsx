'use client'

/**
 * Phase 11.5 — Preset picker UI for StyleProfilePanel.
 *
 * 22 active presets grouped into 6 categories. The currently-selected
 * preset is highlighted with an amber-blue ring + check badge so the
 * user can see at a glance which style is in effect.
 */

import {
  STYLE_PROFILE_PRESETS,
  PRESET_ORDER_BY_CATEGORY,
  CATEGORY_LABEL_ZH,
  type PresetKey,
  type PresetCategory,
  type StylePresetEntry,
} from '@/lib/style-profile/presets'
import { AppIcon } from '@/components/ui/icons'

interface StyleProfilePresetPickerProps {
  onSelect: (preset: StylePresetEntry & { key: PresetKey }) => void
  disabled?: boolean
  /** Which preset is currently saved on the project. Highlighted in the grid. */
  selectedKey?: PresetKey | null
}

const CATEGORY_ORDER: PresetCategory[] = ['realistic', 'anime', 'chinese', 'korean', 'cg-3d', 'western']

export function StyleProfilePresetPicker({
  onSelect,
  disabled = false,
  selectedKey = null,
}: StyleProfilePresetPickerProps) {
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
                const isSelected = selectedKey === key
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect({ key, ...entry })}
                    aria-pressed={isSelected}
                    className={[
                      'group relative flex flex-col gap-2 overflow-hidden rounded-2xl p-4 text-left text-sm shadow-[var(--glass-shadow-sm)] backdrop-blur-md transition-all duration-200',
                      isSelected
                        ? 'border-2 border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] ring-2 ring-[var(--glass-focus-ring-strong)]'
                        : 'border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] hover:-translate-y-0.5 hover:border-[var(--glass-stroke-focus)] hover:shadow-[var(--glass-shadow-md)] hover:ring-2 hover:ring-[var(--glass-focus-ring-strong)]',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                    ].join(' ')}
                  >
                    {/* Top accent bar — full opacity when selected, fades in on hover otherwise */}
                    <span
                      className={[
                        'absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] transition-opacity',
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      ].join(' ')}
                    />

                    {/* Selection check badge */}
                    {isSelected && (
                      <span
                        className="absolute right-3 top-3 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--glass-accent-from)] text-[var(--glass-text-on-accent)] shadow"
                        aria-label="已選"
                      >
                        <AppIcon name="check" className="h-3 w-3" />
                      </span>
                    )}

                    <div className="flex items-baseline justify-between gap-2 pr-7">
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
