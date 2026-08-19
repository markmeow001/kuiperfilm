'use client'

import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useProjectVoicePresets } from '@/lib/query/mutations/useVoiceMutations'

interface SpeakerVoiceBindingDialogProps {
  isOpen: boolean
  speaker: string
  projectId: string
  episodeId: string
  onClose: () => void
  onBound: (speaker: string, voicePresetId: string) => void
}

/**
 * Safe casting surface for an episode speaker.
 *
 * Only server-vetted system presets can be selected. Custom upload and AI
 * design stay visible but disabled until VoiceSource + Consent + Revocation
 * records exist; this component deliberately has no creation/upload imports.
 */
export default function SpeakerVoiceBindingDialog({
  isOpen,
  speaker,
  projectId,
  onClose,
  onBound,
}: SpeakerVoiceBindingDialogProps) {
  const t = useTranslations('voice.inlineBinding')
  const catalog = useProjectVoicePresets(projectId)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const selectedPreset = useMemo(
    () => catalog.data?.find((preset) => preset.id === selectedPresetId) ?? null,
    [catalog.data, selectedPresetId],
  )

  const handleClose = useCallback(() => {
    setSelectedPresetId(null)
    onClose()
  }, [onClose])

  const handleBind = useCallback(() => {
    if (!selectedPreset) return
    onBound(speaker, selectedPreset.id)
    handleClose()
  }, [handleClose, onBound, selectedPreset, speaker])

  if (!isOpen || typeof document === 'undefined') return null

  const titleId = 'speaker-voice-binding-title'
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9999] glass-overlay" aria-hidden="true" onClick={handleClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-surface-modal fixed left-1/2 top-1/2 z-[10000] max-h-[min(760px,calc(100vh-2rem))] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto"
      >
        <header className="flex items-center justify-between border-b border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <AppIcon name="mic" className="h-5 w-5 shrink-0 text-[var(--glass-tone-info-fg)]" />
            <h2 id={titleId} className="truncate font-semibold text-[var(--glass-text-primary)]">
              {t('title', { speaker })}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('close')}
            className="glass-btn-base glass-btn-soft shrink-0 p-2 text-[var(--glass-text-tertiary)]"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-5 p-5">
          <div>
            <p className="text-sm text-[var(--glass-text-secondary)]">{t('description')}</p>
            <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('systemOnly')}</p>
          </div>

          {catalog.isLoading ? (
            <div className="py-10 text-center text-sm text-[var(--glass-text-tertiary)]">{t('catalogLoading')}</div>
          ) : catalog.isError ? (
            <div role="alert" className="rounded-lg border border-red-400/30 p-4 text-sm text-[var(--glass-text-secondary)]">
              <p>{t('catalogError')}</p>
              <button type="button" onClick={() => void catalog.refetch()} className="glass-btn-base glass-btn-soft mt-3 px-3 py-2">
                {t('retry')}
              </button>
            </div>
          ) : catalog.data?.length ? (
            <div className="grid gap-2 sm:grid-cols-2" aria-label={t('catalogLabel')}>
              {catalog.data.map((preset) => {
                const selected = preset.id === selectedPresetId
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedPresetId(preset.id)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? 'border-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)]'
                        : 'border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] hover:border-[var(--glass-stroke-strong)]'
                    }`}
                  >
                    <span className="block font-medium text-[var(--glass-text-primary)]">{preset.name}</span>
                    <span className="mt-1 block text-xs text-[var(--glass-text-tertiary)]">
                      {[preset.gender, preset.description].filter(Boolean).join(' · ') || t('noDescription')}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-[var(--glass-stroke-base)] p-5 text-center text-sm text-[var(--glass-text-tertiary)]">
              {t('catalogEmpty')}
            </p>
          )}

          {selectedPreset ? (
            <audio controls preload="none" src={selectedPreset.previewUrl} className="w-full">
              {t('previewUnavailable')}
            </audio>
          ) : null}

          <section className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled className="glass-btn-base glass-btn-soft cursor-not-allowed px-3 py-2 opacity-50">
                {t('uploadAudio')}
              </button>
              <button type="button" disabled className="glass-btn-base glass-btn-soft cursor-not-allowed px-3 py-2 opacity-50">
                {t('aiDesign')}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('customSourceUnavailable')}</p>
          </section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--glass-stroke-base)] px-5 py-4">
          <button type="button" onClick={handleClose} className="glass-btn-base glass-btn-soft px-4 py-2">
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={!selectedPreset}
            onClick={handleBind}
            className="glass-btn-base glass-btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('bindPreset')}
          </button>
        </footer>
      </div>
    </>,
    document.body,
  )
}
