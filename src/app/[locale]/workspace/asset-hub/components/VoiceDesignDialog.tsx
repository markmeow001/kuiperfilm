'use client'

import { useTranslations } from 'next-intl'

interface VoiceDesignDialogProps {
  isOpen: boolean
  speaker: string
  hasExistingVoice?: boolean
  onClose: () => void
  onSave: (voiceId: string, audioBase64: string) => void
}

/**
 * Fail-closed placeholder, mirroring the project-side dialog at
 * app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/VoiceDesignDialog.tsx.
 *
 * POST /api/asset-hub/voice-design calls rejectLegacyCustomVoiceWrite() and
 * returns 400 VOICE_SOURCE_CONSENT_REQUIRED before reading the body, so the
 * previous live dialog could only ever collect a prompt and then fail. The
 * entry stays so the reason is explained rather than the capability silently
 * disappearing; restore the real body once VoiceSource ownership, Consent, and
 * Revocation records exist.
 */
export default function VoiceDesignDialog({
  isOpen,
  speaker,
  hasExistingVoice = false,
  onClose,
  onSave,
}: VoiceDesignDialogProps) {
  const t = useTranslations('voice.inlineBinding')

  void hasExistingVoice
  void onSave

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--glass-overlay)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-hub-voice-design-title"
        className="w-full max-w-md rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-5 shadow-2xl"
      >
        <h2
          id="asset-hub-voice-design-title"
          className="text-lg font-semibold text-[var(--glass-text-primary)]"
        >
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
