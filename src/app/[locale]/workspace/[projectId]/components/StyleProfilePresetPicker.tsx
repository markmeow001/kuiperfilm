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

export function StyleProfilePresetPicker({ onSelect, disabled = false }: StyleProfilePresetPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PRESET_ORDER.map((key) => {
        const entry = STYLE_PROFILE_PRESETS[key]
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect({ key, ...entry })}
            className="rounded border border-gray-300 px-3 py-2 text-left text-sm transition hover:border-blue-500 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="font-medium">{entry.label}</div>
            <div className="mt-1 line-clamp-2 text-xs text-gray-500">{entry.positivePrompt}</div>
          </button>
        )
      })}
    </div>
  )
}
