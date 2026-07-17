'use client'

/**
 * 手動新增分鏡 modal — Phase 1 of the "B 組 free-prompt workflow" feature.
 *
 * Background: B 組 users prefer writing their own scene prompts rather
 * than relying on the analyze-novel → script-to-storyboard auto-flow.
 * Mirrors the polyfilm.tech (許總) UX referenced in the user's
 * 2026-05-04 screenshots: character chip multi-select + scene chip
 * single-select + free-text 叙事提示词 + duration + one-click create.
 *
 * Flow:
 *   1. User opens modal from "+ 新增手動分鏡" button on storyboard toolbar
 *   2. Picks characters (toggleable chips) + scene (single-select chip)
 *   3. Writes natural-language prompt (例:medium shot. 張騫在廣場中央停步...)
 *   4. Picks duration (5 / 10 / 15s)
 *   5. Click 建立並生圖
 *      → ensure current episode has a storyboard group (auto-create if not)
 *      → POST /api/.../panel with description + characters JSON + location
 *      → trigger image generation on the new panel
 *      → close modal
 *
 * Out of scope for Phase 1 (deferred to Phase 2):
 *   - 自定义参考图 upload
 *   - 道具/物品 chip rail
 *   - Per-character appearance picker (just sends names, not appearanceId)
 *   - Edit existing manual panel (use the existing per-card edit UI)
 */

import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface CharacterOption {
  id: string
  name: string
}

interface LocationOption {
  id: string
  name: string
}

export interface ManualPanelDraft {
  description: string
  characterNames: string[]
  locationName: string | null
  durationSeconds: number
}

interface V2ManualPanelModalProps {
  characters: CharacterOption[]
  locations: LocationOption[]
  /** Called when user clicks 建立。Modal stays open while parent does
   *  the create+gen work; parent calls onClose when done. */
  onSubmit: (draft: ManualPanelDraft) => Promise<void>
  onClose: () => void
  isSubmitting?: boolean
  /** Optional warning to show at top (e.g. "本集還沒有分鏡組,將自動建立") */
  contextHint?: string
}

const DURATION_OPTIONS = [5, 10, 15]

const PROMPT_PLACEHOLDER =
  '[角色] + [場景] + [關鍵動作] + [鏡頭關係] + [氛圍]\n\n' +
  '例:medium shot. 張騫在廣場中央停步,抬頭看向城門。風吹動衣襬。' +
  'camera slowly pushes in as he 再次邁步。'

export function V2ManualPanelModal({
  characters,
  locations,
  onSubmit,
  onClose,
  isSubmitting = false,
  contextHint,
}: V2ManualPanelModalProps) {
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set())
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState<number>(5)

  // Lock body scroll while modal is open. Restore on unmount.
  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [])

  function toggleCharacter(id: string) {
    setSelectedCharacterIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function pickLocation(id: string) {
    setSelectedLocationId((prev) => (prev === id ? null : id))
  }

  const selectedCharacterNames = useMemo(() => {
    return characters.filter((c) => selectedCharacterIds.has(c.id)).map((c) => c.name)
  }, [characters, selectedCharacterIds])

  const selectedLocationName = useMemo(() => {
    if (!selectedLocationId) return null
    return locations.find((l) => l.id === selectedLocationId)?.name ?? null
  }, [locations, selectedLocationId])

  const canSubmit = description.trim().length > 0 && !isSubmitting

  async function handleSubmit() {
    if (!canSubmit) return
    await onSubmit({
      description: description.trim(),
      characterNames: selectedCharacterNames,
      locationName: selectedLocationName,
      durationSeconds: duration,
    })
  }

  return (
    <div className="kuiper-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="kuiper-modal-surface relative max-h-[92vh] w-full max-w-xl overflow-y-auto p-6">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute right-4 top-4 text-text-tertiary transition-colors hover:text-primary-400 disabled:opacity-40"
          aria-label="關閉"
        >
          <AppIcon name="close" className="h-5 w-5" />
        </button>

        <header className="mb-5">
          <div className="font-mono text-[10px] tracking-[0.3em] text-primary-600/80">
            MANUAL · STORYBOARD
          </div>
          <h2 className="mt-1 font-serif-cn text-xl font-medium text-text-primary">
            手動新增分鏡
          </h2>
          {contextHint ? (
            <div className="mt-2 rounded-sm border border-primary-500/20 bg-primary-500/5 px-2.5 py-1.5 font-mono text-[11px] tracking-wider text-primary-400/80">
              {contextHint}
            </div>
          ) : null}
        </header>

        {/* Characters */}
        <section className="mb-5">
          <div className="mb-2 flex items-baseline gap-2">
            <label className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">
              出場角色
            </label>
            <span className="font-mono text-[10px] text-text-tertiary">
              {selectedCharacterNames.length}/{characters.length} 已選
            </span>
          </div>
          {characters.length === 0 ? (
            <div className="rounded-sm border border-border-soft/60 bg-canvas/40 px-3 py-2 font-fraunces text-xs italic text-text-tertiary">
              本專案還沒有角色,先到劇本拆解 tab 建幾個。
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {characters.map((c) => {
                const active = selectedCharacterIds.has(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCharacter(c.id)}
                    disabled={isSubmitting}
                    className={`rounded-sm border px-3 py-1.5 font-serif-cn text-sm transition-all ${
                      active
                        ? 'border-primary-500 bg-primary-500/15 text-primary-200'
                        : 'border-border-soft bg-raised/60 text-text-secondary hover:border-primary-500/40 hover:text-primary-300'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Scene */}
        <section className="mb-5">
          <div className="mb-2 flex items-baseline gap-2">
            <label className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">
              場景
            </label>
            <span className="font-mono text-[10px] text-text-tertiary">
              {selectedLocationName ? '已選' : '可選'} · 單選
            </span>
          </div>
          {locations.length === 0 ? (
            <div className="rounded-sm border border-border-soft/60 bg-canvas/40 px-3 py-2 font-fraunces text-xs italic text-text-tertiary">
              本專案還沒有場景,先到劇本拆解 tab 建一個或打 prompt 直接寫。
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {locations.map((l) => {
                const active = selectedLocationId === l.id
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => pickLocation(l.id)}
                    disabled={isSubmitting}
                    className={`rounded-sm border px-3 py-1.5 font-serif-cn text-sm transition-all ${
                      active
                        ? 'border-primary-500 bg-primary-500/15 text-primary-200'
                        : 'border-border-soft bg-raised/60 text-text-secondary hover:border-primary-500/40 hover:text-primary-300'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {l.name}
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Prompt */}
        <section className="mb-5">
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">
              敘事提示詞
            </label>
            <span className="font-mono text-[10px] text-text-tertiary">
              {description.length} 字
            </span>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSubmitting}
            rows={7}
            placeholder={PROMPT_PLACEHOLDER}
            className="w-full resize-none rounded-sm border border-border-soft bg-canvas px-3 py-2 font-serif-cn text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-500/60 focus:outline-none disabled:opacity-50"
          />
        </section>

        {/* Duration */}
        <section className="mb-6">
          <label className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-text-secondary">
            時長 (秒)
          </label>
          <div className="flex gap-2">
            {DURATION_OPTIONS.map((d) => {
              const active = duration === d
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  disabled={isSubmitting}
                  className={`min-w-[64px] rounded-sm border px-3 py-1.5 font-mono text-sm tracking-wider transition-all ${
                    active
                      ? 'border-primary-500 bg-primary-500/15 text-primary-200'
                      : 'border-border-soft bg-raised/60 text-text-secondary hover:border-primary-500/40 hover:text-primary-300'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {d}s
                </button>
              )
            })}
          </div>
        </section>

        {/* Actions */}
        <footer className="flex justify-end gap-2 border-t border-border-soft/60 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-sm border border-border-soft bg-raised/40 px-4 py-2 font-serif-cn text-sm text-text-secondary transition-all hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-sm bg-primary-500 px-5 py-2 font-serif-cn text-sm font-medium text-canvas transition-all hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? '建立中…' : '建立並生圖'}
          </button>
        </footer>
      </div>
    </div>
  )
}
