'use client'

import { useTranslations } from 'next-intl'

interface VoiceDesignDialogProps {
  isOpen: boolean
  speaker: string
  onClose: () => void
}

/**
 * Fail-closed placeholder. AI voice design must not call a provider until
 * VoiceSource ownership, Consent, and Revocation records are enforceable.
 */
export default function VoiceDesignDialog({
  isOpen,
  speaker,
  onClose,
}: VoiceDesignDialogProps) {
  const t = useTranslations('voice.inlineBinding')

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--glass-overlay)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-voice-design-title"
        className="w-full max-w-md rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-5 shadow-2xl"
      >
        <h2 id="project-voice-design-title" className="text-lg font-semibold text-[var(--glass-text-primary)]">
          {t('title', { speaker })}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--glass-text-secondary)]">
          {t('customSourceUnavailable')}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-lg border border-[var(--glass-stroke-base)] px-4 py-2 text-sm text-[var(--glass-text-tertiary)] opacity-55"
          >
            {t('aiDesign')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--glass-stroke-base)] px-4 py-2 text-sm text-[var(--glass-text-secondary)]"
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
