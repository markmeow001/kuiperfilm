'use client'

/**
 * Phase 11.5 — StyleProfilePanel
 *
 * Project 级 styleProfile 编辑面板：
 *  - Preset selector（4 个 preset → 点击填入两个 textarea）
 *  - stylePositivePrompt textarea + char count + 软上限 8000 提示
 *  - styleNegativePrompt textarea 同上
 *  - styleReferenceImages：MediaObject id 列表（手工输入或后续接入 uploader）
 *  - Save 按钮调用 useUpdateStyleProfile mutation
 */

import { useState, useMemo, useEffect, type ChangeEvent } from 'react'
import { useUpdateStyleProfile } from '@/lib/query/mutations/updateStyleProfile'
import { useStyleProfile } from '@/lib/query/hooks/useStyleProfile'
import { StyleProfilePresetPicker } from './StyleProfilePresetPicker'
import type { PresetKey, StylePresetEntry } from '@/lib/style-profile/presets'

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
    <span className={exceeded ? 'text-red-600' : 'text-gray-500'}>
      {count}/{limit} chars{exceeded ? ' (exceeds soft limit)' : ''}
    </span>
  )
}

export function StyleProfilePanel({ projectId }: StyleProfilePanelProps) {
  // Q-008: prefill from server so opening the panel shows previously-saved values
  // and Save no longer wipes existing data.
  const styleProfileQuery = useStyleProfile(projectId)
  const [positivePrompt, setPositivePrompt] = useState<string>('')
  const [negativePrompt, setNegativePrompt] = useState<string>('')
  const [referenceImagesText, setReferenceImagesText] = useState<string>('')
  const [hasInitialized, setHasInitialized] = useState(false)

  // Initialize textareas once the GET response arrives. Subsequent invalidations
  // (e.g. after Save) refresh the cache but we do NOT clobber unsaved edits.
  useEffect(() => {
    if (hasInitialized) return
    if (!styleProfileQuery.data) return
    setPositivePrompt(styleProfileQuery.data.stylePositivePrompt ?? '')
    setNegativePrompt(styleProfileQuery.data.styleNegativePrompt ?? '')
    setReferenceImagesText((styleProfileQuery.data.styleReferenceImages ?? []).join('\n'))
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

  const handleApplyPreset = (preset: StylePresetEntry & { key: PresetKey }) => {
    setPositivePrompt(preset.positivePrompt)
    setNegativePrompt(preset.negativePrompt)
  }

  const handleSave = () => {
    mutation.mutate({
      stylePositivePrompt: positivePrompt.length > 0 ? positivePrompt : null,
      styleNegativePrompt: negativePrompt.length > 0 ? negativePrompt : null,
      styleReferenceImages: referenceImageIds.length > 0 ? referenceImageIds : null,
    })
  }

  const handleClearAll = () => {
    setPositivePrompt('')
    setNegativePrompt('')
    setReferenceImagesText('')
  }

  return (
    <div className="space-y-5 rounded-2xl border-2 border-[var(--glass-stroke-focus)] bg-[var(--glass-bg-surface)] p-5 shadow-[var(--glass-shadow-md)]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">視覺風格 / Style Profile</h3>
          <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
            這個風格會套用到全片每張圖跟每段影片的生成。請先選一個 preset,系統會在每個 prompt 前面自動加上對應的風格描述。
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--glass-tone-info-fg)]">
          開始前必選
        </span>
      </header>

      <section className="rounded-xl bg-[var(--glass-bg-muted)] p-4">
        <h4 className="mb-3 text-sm font-semibold text-[var(--glass-text-primary)]">
          快速套用 preset(直接點下方任一個)
        </h4>
        <StyleProfilePresetPicker onSelect={handleApplyPreset} disabled={mutation.isPending} />
      </section>

      <section>
        <label className="mb-1 flex items-center justify-between text-sm font-medium">
          <span>Positive prompt</span>
          <CharCountHint count={positiveCount} limit={PROMPT_SOFT_LIMIT} />
        </label>
        <textarea
          className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
          rows={5}
          value={positivePrompt}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPositivePrompt(e.target.value)}
          placeholder="Describe the global art style you want every panel to follow."
        />
      </section>

      <section>
        <label className="mb-1 flex items-center justify-between text-sm font-medium">
          <span>Negative prompt</span>
          <CharCountHint count={negativeCount} limit={PROMPT_SOFT_LIMIT} />
        </label>
        <textarea
          className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
          rows={4}
          value={negativePrompt}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNegativePrompt(e.target.value)}
          placeholder="Things to avoid (only applied if the chosen model supports negative prompt)."
        />
      </section>

      <section>
        <label className="mb-1 flex items-center justify-between text-sm font-medium">
          <span>Reference image media ids</span>
          <span className="text-gray-500">{referenceImageIds.length} item(s)</span>
        </label>
        <textarea
          className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
          rows={3}
          value={referenceImagesText}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReferenceImagesText(e.target.value)}
          placeholder="One MediaObject id per line. Upload images via the asset hub and paste their ids here."
        />
        <p className="mt-1 text-xs text-gray-500">
          Comma- or newline-separated. Only applied when the chosen model supports reference images.
        </p>
      </section>

      {mutation.isError ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(mutation.error as Error)?.message ?? 'Failed to save style profile.'}
        </p>
      ) : null}

      {mutation.isSuccess ? (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Style profile saved.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={handleSave}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={handleClearAll}
          className="rounded border border-gray-300 px-4 py-2 text-sm transition hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear all
        </button>
      </div>
    </div>
  )
}
