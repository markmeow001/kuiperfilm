'use client'

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type {
  VoiceLineDraftPayload,
  VoicePanelOption,
  VoicePanelQueryState,
} from './voice-workspace-types'

interface VoiceLineEditorFormProps {
  mode: 'add' | 'edit'
  formLabel: string
  initialContent?: string
  initialSpeaker?: string
  initialMatchedPanelId?: string | null
  panelOptions: VoicePanelOption[]
  panelQueryState: VoicePanelQueryState
  onSave: (payload: VoiceLineDraftPayload) => Promise<void>
  onCancel: () => void
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function isNonRetryableClientError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && status >= 400 && status < 500
}

export function VoiceLineEditorForm({
  mode,
  formLabel,
  initialContent = '',
  initialSpeaker = '',
  initialMatchedPanelId = null,
  panelOptions,
  panelQueryState,
  onSave,
  onCancel,
}: VoiceLineEditorFormProps) {
  const t = useTranslations('v2Voice')
  const [content, setContent] = useState(initialContent)
  const [speaker, setSpeaker] = useState(initialSpeaker)
  const [matchedPanelId, setMatchedPanelId] = useState(initialMatchedPanelId ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientRequestId, setClientRequestId] = useState(() => (
    mode === 'add' ? crypto.randomUUID() : null
  ))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedContent = content.trim()
    const normalizedSpeaker = speaker.trim()
    if (!normalizedContent || !normalizedSpeaker) {
      setError(t('lineEditor.required'))
      return
    }

    setError(null)
    setIsSaving(true)
    try {
      await onSave({
        content: normalizedContent,
        speaker: normalizedSpeaker,
        matchedPanelId: matchedPanelId || null,
        ...(clientRequestId ? { clientRequestId } : {}),
      })
      onCancel()
    } catch (saveError) {
      setError(getErrorMessage(saveError, t(`errors.${mode === 'add' ? 'addLineFailed' : 'updateLineFailed'}`)))
      if (mode === 'add' && isNonRetryableClientError(saveError)) {
        setClientRequestId(crypto.randomUUID())
      }
    } finally {
      setIsSaving(false)
    }
  }

  const submitLabel = isSaving
    ? t(`lineEditor.${mode === 'add' ? 'adding' : 'saving'}`)
    : error
      ? t(`lineEditor.${mode === 'add' ? 'retryAdd' : 'retrySave'}`)
      : t(`lineEditor.${mode === 'add' ? 'add' : 'save'}`)
  const currentPanelIsMissing = Boolean(matchedPanelId)
    && !panelOptions.some((option) => option.id === matchedPanelId)

  return (
    <form
      aria-label={formLabel}
      aria-busy={isSaving}
      className="min-w-0 rounded-[var(--r-card)] border border-border-soft bg-surface-overlay/60 p-4"
      onSubmit={handleSubmit}
    >
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(10rem,0.35fr)]">
        <label className="min-w-0 lg:col-span-2">
          <span className="mb-1.5 block text-[11px] font-medium text-text-tertiary">
            {t('lineEditor.content')}
          </span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={isSaving}
            required
            rows={3}
            className="kuiper-input min-h-11 w-full min-w-0 resize-y px-3 py-2 text-sm disabled:opacity-50"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1.5 block text-[11px] font-medium text-text-tertiary">
            {t('lineEditor.speaker')}
          </span>
          <input
            value={speaker}
            onChange={(event) => setSpeaker(event.target.value)}
            disabled={isSaving}
            required
            className="kuiper-input min-h-11 w-full min-w-0 px-3 py-2 text-sm disabled:opacity-50"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1.5 block text-[11px] font-medium text-text-tertiary">
            {t('lineEditor.shotBinding')}
          </span>
          <select
            value={matchedPanelId}
            onChange={(event) => setMatchedPanelId(event.target.value)}
            disabled={isSaving || panelQueryState !== 'ready'}
            className="kuiper-input min-h-11 w-full min-w-0 px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="">{t('lineEditor.noShot')}</option>
            {currentPanelIsMissing ? (
              <option value={matchedPanelId}>{t('lineEditor.currentShotUnavailable')}</option>
            ) : null}
            {panelOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>
      ) : null}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={isSaving}
          onClick={onCancel}
          className="kuiper-secondary-button min-h-11 px-4 text-xs disabled:opacity-50"
        >
          {t('lineEditor.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="kuiper-primary-button min-h-11 rounded-[var(--r-input)] px-4 text-xs font-semibold disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
