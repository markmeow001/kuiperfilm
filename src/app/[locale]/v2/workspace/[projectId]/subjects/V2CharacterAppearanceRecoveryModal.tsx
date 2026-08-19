'use client'

import { useTranslations } from 'next-intl'
import { Modal } from '@/components/v2/Modal'
import { V2CharacterAppearancesPanel } from './V2CharacterAppearancesPanel'

interface V2CharacterAppearanceRecoveryModalProps {
  projectId: string
  currentEpisodeId: string | null
  characterId: string
  onClose: () => void
}

/**
 * Recovery-only editor for a character that has no appearance rows yet.
 * Keeping this surface separate from the regular editor means every image,
 * AI, Ark and finalization action remains unavailable until a concrete
 * appearance can be resolved.
 */
export function V2CharacterAppearanceRecoveryModal({
  projectId,
  currentEpisodeId,
  characterId,
  onClose,
}: V2CharacterAppearanceRecoveryModalProps) {
  const t = useTranslations('v2Subjects.activeAppearance')

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      className="kuiper-workspace max-h-[calc(100dvh-2rem)] min-w-0 overflow-hidden"
    >
      <Modal.Header
        heading={t('recoveryTitle')}
        subtitle={t('recoveryBody')}
        onClose={onClose}
        closeAriaLabel={t('recoveryClose')}
      />
      <Modal.Body
        data-testid="appearance-recovery-body"
        className="min-w-0 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-5 [&_button]:min-h-11 [&_input]:min-h-11"
      >
        <V2CharacterAppearancesPanel
          projectId={projectId}
          characterId={characterId}
          currentEpisodeId={currentEpisodeId}
          activeAppearanceId=""
          appearances={[]}
        />
      </Modal.Body>
      <Modal.Footer>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center justify-center rounded-input border border-[var(--production-border)] px-4 font-body text-[14px] text-[var(--production-ink-muted)] transition-colors hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
        >
          {t('recoveryClose')}
        </button>
      </Modal.Footer>
    </Modal>
  )
}
