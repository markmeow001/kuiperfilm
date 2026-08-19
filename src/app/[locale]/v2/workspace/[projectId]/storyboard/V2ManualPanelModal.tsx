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
 *   5. Click 建立分鏡
 *      → atomically create one storyboard group + the real panel draft
 *      → never trigger image generation or any other AI task
 *      → parent closes the modal only after the server confirms success
 *
 * Out of scope for Phase 1 (deferred to Phase 2):
 *   - 自定义参考图 upload
 *   - 道具/物品 chip rail
 *   - Per-character appearance picker (just sends names, not appearanceId)
 *   - Edit existing manual panel (use the existing per-card edit UI)
 */

import { useId, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { Modal } from '@/components/v2/Modal'

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

export interface V2ManualPanelModalProps {
  characters: CharacterOption[]
  locations: LocationOption[]
  /** Called when user clicks 建立。Modal stays open while the parent stores
   *  the draft; no generation is started by this callback. */
  onSubmit: (draft: ManualPanelDraft) => Promise<void>
  onClose: () => void
  isSubmitting?: boolean
  /** Optional warning to show at top (e.g. "本集還沒有分鏡組,將自動建立") */
  contextHint?: string
  /** Parent-owned failure state. Keeping it outside the modal lets a failed
   *  request re-render without discarding the user's local draft. */
  submitError?: string | null
  /** Parent-owned recovery snapshot used when the modal is closed and opened
   *  again after an outcome-unknown request. */
  initialDraft?: ManualPanelDraft
  onDraftChange?: (draft: ManualPanelDraft) => void
  /** Outcome-unknown requests must replay the exact same body with the same
   *  idempotency key, so editing is locked until reconciliation succeeds. */
  draftLocked?: boolean
}

const DURATION_OPTIONS = [5, 10, 15]

export function V2ManualPanelModal({
  characters,
  locations,
  onSubmit,
  onClose,
  isSubmitting = false,
  contextHint,
  submitError,
  initialDraft,
  onDraftChange,
  draftLocked = false,
}: V2ManualPanelModalProps) {
  const t = useTranslations('v2Storyboard.manualPanel')
  const promptId = useId()
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(
    () => new Set(
      characters
        .filter((character) => initialDraft?.characterNames.includes(character.name))
        .map((character) => character.id),
    ),
  )
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    () => locations.find((location) => location.name === initialDraft?.locationName)?.id ?? null,
  )
  const [description, setDescription] = useState(initialDraft?.description ?? '')
  const [duration, setDuration] = useState<number>(initialDraft?.durationSeconds ?? 5)

  function toggleCharacter(id: string) {
    const next = new Set(selectedCharacterIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedCharacterIds(next)
    onDraftChange?.({
      description,
      characterNames: characters
        .filter((character) => next.has(character.id))
        .map((character) => character.name),
      locationName: selectedLocationId
        ? locations.find((location) => location.id === selectedLocationId)?.name ?? null
        : null,
      durationSeconds: duration,
    })
  }

  function pickLocation(id: string) {
    const next = selectedLocationId === id ? null : id
    setSelectedLocationId(next)
    onDraftChange?.({
      description,
      characterNames: characters
        .filter((character) => selectedCharacterIds.has(character.id))
        .map((character) => character.name),
      locationName: next
        ? locations.find((location) => location.id === next)?.name ?? null
        : null,
      durationSeconds: duration,
    })
  }

  function updateDescription(nextDescription: string) {
    setDescription(nextDescription)
    onDraftChange?.({
      description: nextDescription,
      characterNames: selectedCharacterNames,
      locationName: selectedLocationName,
      durationSeconds: duration,
    })
  }

  function updateDuration(nextDuration: number) {
    setDuration(nextDuration)
    onDraftChange?.({
      description,
      characterNames: selectedCharacterNames,
      locationName: selectedLocationName,
      durationSeconds: nextDuration,
    })
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
    <Modal
      open
      onClose={onClose}
      size="lg"
      ariaLabel={t('title')}
      dismissOnBackdrop={!isSubmitting}
      dismissOnEscape={!isSubmitting}
      className="kuiper-modal-surface max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      <div className="p-4 sm:p-6">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          data-initial-focus
          className="absolute right-3 top-3 inline-flex min-h-11 min-w-11 items-center justify-center text-text-tertiary transition-colors hover:text-primary-400 disabled:opacity-40 sm:right-4 sm:top-4"
          aria-label={t('close')}
        >
          <AppIcon name="close" className="h-5 w-5" />
        </button>

        <header className="mb-5">
          <div className="font-mono text-[10px] tracking-[0.3em] text-primary-600/80">
            {t('eyebrow')}
          </div>
          <h2 className="mt-1 font-serif-cn text-xl font-medium text-text-primary">
            {t('title')}
          </h2>
          <p className="mt-2 border-l-2 border-primary-500/50 pl-3 text-sm leading-relaxed text-text-secondary">
            {t('nonAiNotice')}
          </p>
          {contextHint ? (
            <div className="mt-2 rounded-sm border border-primary-500/20 bg-primary-500/5 px-2.5 py-1.5 font-mono text-[11px] tracking-wider text-primary-400/80">
              {contextHint}
            </div>
          ) : null}
        </header>

        {/* Characters */}
        <section className="mb-5">
          <div className="mb-2 flex items-baseline gap-2">
            <div className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">
              {t('characters')}
            </div>
            <span className="font-mono text-[10px] text-text-tertiary">
              {t('selectedCharacters', {
                selected: selectedCharacterNames.length,
                total: characters.length,
              })}
            </span>
          </div>
          {characters.length === 0 ? (
            <div className="rounded-sm border border-border-soft/60 bg-canvas/40 px-3 py-2 font-fraunces text-xs italic text-text-tertiary">
              {t('noCharacters')}
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
                    disabled={isSubmitting || draftLocked}
                    aria-pressed={active}
                    className={`min-h-11 rounded-sm border px-3 py-1.5 font-serif-cn text-sm transition-all ${
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
            <div className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">
              {t('location')}
            </div>
            <span className="font-mono text-[10px] text-text-tertiary">
              {t(selectedLocationName ? 'locationSelected' : 'locationOptional')}
            </span>
          </div>
          {locations.length === 0 ? (
            <div className="rounded-sm border border-border-soft/60 bg-canvas/40 px-3 py-2 font-fraunces text-xs italic text-text-tertiary">
              {t('noLocations')}
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
                    disabled={isSubmitting || draftLocked}
                    aria-pressed={active}
                    className={`min-h-11 rounded-sm border px-3 py-1.5 font-serif-cn text-sm transition-all ${
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
            <label htmlFor={promptId} className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">
              {t('prompt')}
            </label>
            <span className="font-mono text-[10px] text-text-tertiary">
              {t('characterCount', { count: description.length })}
            </span>
          </div>
          <textarea
            id={promptId}
            value={description}
            onChange={(event) => updateDescription(event.target.value)}
            disabled={isSubmitting || draftLocked}
            aria-readonly={draftLocked}
            rows={7}
            placeholder={t('promptPlaceholder')}
            className="w-full resize-none rounded-sm border border-border-soft bg-canvas px-3 py-2 font-serif-cn text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-500/60 focus:outline-none disabled:opacity-50"
          />
        </section>

        {/* Duration */}
        <section className="mb-6">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary">
            {t('duration')}
          </div>
          <div className="flex flex-wrap gap-2">
            {DURATION_OPTIONS.map((d) => {
              const active = duration === d
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => updateDuration(d)}
                  disabled={isSubmitting || draftLocked}
                  aria-pressed={active}
                  className={`min-h-11 min-w-[64px] rounded-sm border px-3 py-1.5 font-mono text-sm tracking-wider transition-all ${
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

        {submitError ? (
          <div
            role="alert"
            className="mb-4 rounded-sm border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {submitError}
          </div>
        ) : null}

        {draftLocked ? (
          <p className="mb-4 text-xs leading-relaxed text-text-tertiary">
            {t('recoveryLocked')}
          </p>
        ) : null}

        {/* Actions */}
        <footer className="flex flex-col-reverse justify-end gap-2 border-t border-border-soft/60 pt-4 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-11 rounded-sm border border-border-soft bg-raised/40 px-4 py-2 font-serif-cn text-sm text-text-secondary transition-all hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="min-h-11 rounded-sm bg-primary-500 px-5 py-2 font-serif-cn text-sm font-medium text-canvas transition-all hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting
              ? t('creating')
              : draftLocked
                ? t('retryCreate')
                : t('create')}
          </button>
        </footer>
      </div>
    </Modal>
  )
}
