'use client'

/**
 * Phase 11.5 — StyleProfilePanel
 *
 * Project-level styleProfile editor:
 *  - 22 preset cards in 6 categories (handled by StyleProfilePresetPicker)
 *  - Clicking a preset is the save: writes stylePresetKey + positive/negative
 *    prompts to the server in one shot, no separate "Save" button required.
 *  - The selected preset stays visually highlighted across reloads because
 *    we round-trip stylePresetKey through the DB.
 *  - Free-form prompts and reference image ids are still editable below
 *    for power users; the lower "Save manual edits" button covers that path.
 */

import { useState, useMemo, useEffect, type ChangeEvent } from 'react'
import { useUpdateStyleProfile } from '@/lib/query/mutations/updateStyleProfile'
import { useStyleProfile } from '@/lib/query/hooks/useStyleProfile'
import { StyleProfilePresetPicker } from './StyleProfilePresetPicker'
import {
  STYLE_PROFILE_PRESETS,
  type PresetKey,
  type StylePresetEntry,
} from '@/lib/style-profile/presets'

const PROMPT_SOFT_LIMIT = 8000

export interface StyleProfilePanelProps {
  projectId: string
}

interface CharCountHintProps {
  count: number
  limit: number
}

function CharCountHint({ count, limit }: CharCountHintProps) {
  const exceeded = count > limit
  return (
    <span className={exceeded ? 'text-[var(--glass-tone-danger-fg)]' : 'text-[var(--glass-text-tertiary)]'}>
      {count}/{limit} chars{exceeded ? ' (exceeds soft limit)' : ''}
    </span>
  )
}

export function StyleProfilePanel({ projectId }: StyleProfilePanelProps) {
  const styleProfileQuery = useStyleProfile(projectId)
  const [positivePrompt, setPositivePrompt] = useState<string>('')
  const [negativePrompt, setNegativePrompt] = useState<string>('')
  const [referenceImagesText, setReferenceImagesText] = useState<string>('')
  const [selectedPresetKey, setSelectedPresetKey] = useState<PresetKey | null>(null)
  const [hasInitialized, setHasInitialized] = useState(false)

  // Initialize once from server.
  useEffect(() => {
    if (hasInitialized) return
    if (!styleProfileQuery.data) return
    setPositivePrompt(styleProfileQuery.data.stylePositivePrompt ?? '')
    setNegativePrompt(styleProfileQuery.data.styleNegativePrompt ?? '')
    setReferenceImagesText((styleProfileQuery.data.styleReferenceImages ?? []).join('\n'))
    const storedKey = styleProfileQuery.data.stylePresetKey
    setSelectedPresetKey(
      storedKey && storedKey in STYLE_PROFILE_PRESETS ? (storedKey as PresetKey) : null,
    )
    setHasInitialized(true)
  }, [hasInitialized, styleProfileQuery.data])

  const mutation = useUpdateStyleProfile(projectId)

  const positiveCount = positivePrompt.length
  const negativeCount = negativePrompt.length

  const referenceImageIds = useMemo(() => {
    return referenceImagesText
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  }, [referenceImagesText])

  const positiveExceeded = positiveCount > PROMPT_SOFT_LIMIT
  const negativeExceeded = negativeCount > PROMPT_SOFT_LIMIT
  const canSave = !positiveExceeded && !negativeExceeded && !mutation.isPending

  // Preset click = instant save. We update local state and fire the mutation
  // in the same tick so the picker can light up the selected card immediately.
  const handleApplyPreset = (preset: StylePresetEntry & { key: PresetKey }) => {
    setPositivePrompt(preset.positivePrompt)
    setNegativePrompt(preset.negativePrompt)
    setSelectedPresetKey(preset.key)
    mutation.mutate({
      stylePositivePrompt: preset.positivePrompt,
      styleNegativePrompt: preset.negativePrompt,
      styleReferenceImages: referenceImageIds.length > 0 ? referenceImageIds : null,
      stylePresetKey: preset.key,
    })
  }

  // Manual edits below the picker still need an explicit save because the
  // user is mid-typing; we don't fire on every keystroke.
  const handleSaveManualEdits = () => {
    mutation.mutate({
      stylePositivePrompt: positivePrompt.length > 0 ? positivePrompt : null,
      styleNegativePrompt: negativePrompt.length > 0 ? negativePrompt : null,
      styleReferenceImages: referenceImageIds.length > 0 ? referenceImageIds : null,
      // Manual edits drift away from any preset → drop the link so the picker
      // stops showing a stale selection.
      stylePresetKey: null,
    })
    setSelectedPresetKey(null)
  }

  const handleClearAll = () => {
    setPositivePrompt('')
    setNegativePrompt('')
    setReferenceImagesText('')
    setSelectedPresetKey(null)
    mutation.mutate({
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: null,
      stylePresetKey: null,
    })
  }

  const selectedPresetLabel = selectedPresetKey
    ? STYLE_PROFILE_PRESETS[selectedPresetKey].zhLabel
    : null

  return (
    <div className="space-y-5 rounded-2xl border-2 border-[var(--glass-stroke-focus)] bg-[var(--glass-bg-surface)] p-5 shadow-[var(--glass-shadow-md)]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">視覺風格 / Style Profile</h3>
          <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
            點選任一張卡片即套用並自動儲存,該風格會在後續所有圖片 / 影片生成時自動加進 prompt。
          </p>
          {selectedPresetLabel ? (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] px-3 py-1 text-xs font-medium text-[var(--glass-tone-info-fg)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--glass-tone-info-fg)]" />
              目前風格:<strong className="font-semibold">{selectedPresetLabel}</strong>
              {mutation.isPending ? <span className="text-[10px] opacity-70">儲存中…</span> : null}
            </p>
          ) : (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--glass-stroke-warning)] bg-[var(--glass-tone-warning-bg)] px-3 py-1 text-xs font-medium text-[var(--glass-tone-warning-fg)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--glass-tone-warning-fg)]" />
              尚未選擇風格
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--glass-tone-info-fg)]">
          開始前必選
        </span>
      </header>

      <section className="rounded-xl bg-[var(--glass-bg-muted)] p-4">
        <StyleProfilePresetPicker
          onSelect={handleApplyPreset}
          disabled={mutation.isPending}
          selectedKey={selectedPresetKey}
        />
      </section>

      <details className="rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)]/60">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--glass-text-secondary)]">
          進階手動編輯 prompt(可選)
        </summary>
        <div className="space-y-4 px-4 pb-4">
          <section>
            <label className="mb-1 flex items-center justify-between text-sm font-medium text-[var(--glass-text-primary)]">
              <span>Positive prompt</span>
              <CharCountHint count={positiveCount} limit={PROMPT_SOFT_LIMIT} />
            </label>
            <textarea
              className="w-full rounded border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-2 text-sm text-[var(--glass-text-primary)] focus:border-[var(--glass-stroke-focus)] focus:outline-none"
              rows={5}
              value={positivePrompt}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPositivePrompt(e.target.value)}
              placeholder="Describe the global art style you want every panel to follow."
            />
          </section>

          <section>
            <label className="mb-1 flex items-center justify-between text-sm font-medium text-[var(--glass-text-primary)]">
              <span>Negative prompt</span>
              <CharCountHint count={negativeCount} limit={PROMPT_SOFT_LIMIT} />
            </label>
            <textarea
              className="w-full rounded border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-2 text-sm text-[var(--glass-text-primary)] focus:border-[var(--glass-stroke-focus)] focus:outline-none"
              rows={4}
              value={negativePrompt}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNegativePrompt(e.target.value)}
              placeholder="Things to avoid (only applied if the chosen model supports negative prompt)."
            />
          </section>

          <section>
            <label className="mb-1 flex items-center justify-between text-sm font-medium text-[var(--glass-text-primary)]">
              <span>Reference image media ids</span>
              <span className="text-[var(--glass-text-tertiary)]">{referenceImageIds.length} item(s)</span>
            </label>
            <textarea
              className="w-full rounded border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-2 text-sm text-[var(--glass-text-primary)] focus:border-[var(--glass-stroke-focus)] focus:outline-none"
              rows={3}
              value={referenceImagesText}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReferenceImagesText(e.target.value)}
              placeholder="One MediaObject id per line. Upload images via the asset hub and paste their ids here."
            />
            <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
              Comma- or newline-separated. Only applied when the chosen model supports reference images.
            </p>
          </section>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              disabled={!canSave}
              onClick={handleSaveManualEdits}
              className="rounded-lg bg-[var(--glass-accent-from)] px-4 py-2 text-sm font-medium text-[var(--glass-text-on-accent)] transition hover:bg-[var(--glass-accent-to)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? '儲存中…' : '儲存手動編輯'}
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={handleClearAll}
              className="rounded-lg border border-[var(--glass-stroke-base)] px-4 py-2 text-sm text-[var(--glass-text-secondary)] transition hover:border-[var(--glass-stroke-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              清除全部
            </button>
          </div>
        </div>
      </details>

      {mutation.isError ? (
        <p className="rounded-lg border border-[var(--glass-stroke-danger)] bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-sm text-[var(--glass-tone-danger-fg)]">
          {(mutation.error as Error)?.message ?? 'Failed to save style profile.'}
        </p>
      ) : null}
    </div>
  )
}
