'use client'

import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'

export interface VoiceCreationModalShellProps {
    isOpen: boolean
    folderId: string | null
    onClose: () => void
    onSuccess: () => void
    /** 预填充的音色名称（如发言人名字） */
    initialVoiceName?: string
}

/**
 * Fail-closed placeholder.
 *
 * Every write this modal used to perform is refused by the backend: the
 * upload, AI-design, and save paths all reach Asset Hub endpoints that call
 * rejectLegacyCustomVoiceWrite() and return 400 VOICE_SOURCE_CONSENT_REQUIRED.
 * Keeping the creation form live meant a user could fill in a name, record or
 * upload a sample, wait for a preview, and only then be rejected.
 *
 * The entry point is kept (rather than removed) so the capability stays
 * discoverable and the reason is explained, matching the project-side
 * treatment in
 * app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/VoiceDesignDialog.tsx.
 * Restoring the feature means replacing this body once VoiceSource ownership,
 * Consent, and Revocation records exist.
 */
export default function VoiceCreationModalLayout({
    isOpen,
    folderId,
    onClose,
    onSuccess,
    initialVoiceName,
}: VoiceCreationModalShellProps) {
    const t = useTranslations('assetHub')
    const tVoice = useTranslations('voice.inlineBinding')

    void folderId
    void onSuccess
    void initialVoiceName

    if (!isOpen) return null
    if (typeof document === 'undefined') return null

    return createPortal(
        <>
            <div className="fixed inset-0 z-[9999] glass-overlay" onClick={onClose} />
            <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 pointer-events-none">
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="asset-hub-voice-creation-title"
                    className="pointer-events-auto w-full max-w-md rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-5 shadow-2xl"
                >
                    <h2
                        id="asset-hub-voice-creation-title"
                        className="text-lg font-semibold text-[var(--glass-text-primary)]"
                    >
                        {t('addVoice')}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--glass-text-secondary)]">
                        {tVoice('customSourceUnavailable')}
                    </p>
                    <div className="mt-5 flex justify-end gap-2">
                        <button
                            type="button"
                            disabled
                            className="cursor-not-allowed rounded-lg border border-[var(--glass-stroke-base)] px-4 py-2 text-sm text-[var(--glass-text-tertiary)] opacity-55"
                        >
                            {tVoice('uploadAudio')}
                        </button>
                        <button
                            type="button"
                            disabled
                            className="cursor-not-allowed rounded-lg border border-[var(--glass-stroke-base)] px-4 py-2 text-sm text-[var(--glass-text-tertiary)] opacity-55"
                        >
                            {tVoice('aiDesign')}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-[var(--glass-stroke-base)] px-4 py-2 text-sm text-[var(--glass-text-secondary)]"
                        >
                            {tVoice('close')}
                        </button>
                    </div>
                </div>
            </div>
        </>,
        document.body,
    )
}
