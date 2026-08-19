'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

interface VoiceSettingsProps {
  characterId: string
  onSelectFromHub?: (characterId: string) => void
  compact?: boolean
}

/**
 * Project voice source controls are intentionally inert until VoiceSource,
 * Consent, and Revocation records can be persisted and enforced.
 */
export default function VoiceSettings({
  characterId,
  onSelectFromHub,
  compact = false,
}: VoiceSettingsProps) {
  const assetsT = useTranslations('assets')
  const voiceT = useTranslations('voice.inlineBinding')
  const descriptionId = `project-custom-voice-unavailable-${characterId}`
  const containerClass = compact
    ? 'rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] p-3'
    : 'mt-4 rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] p-4'

  return (
    <div className={containerClass}>
      <div className="mb-2 flex items-center gap-2 border-b border-[var(--glass-stroke-warning)] pb-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--glass-tone-warning-bg)]">
          <AppIcon name="mic" className="h-3 w-3 text-[var(--glass-tone-warning-fg)]" />
        </span>
        <span className="text-xs font-medium text-[var(--glass-tone-warning-fg)]">
          {assetsT('tts.title')}
        </span>
      </div>

      <div
        className="flex w-full flex-wrap justify-center gap-2"
        aria-describedby={descriptionId}
      >
        <button
          type="button"
          disabled
          className="min-w-[80px] flex-1 cursor-not-allowed rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-1.5 text-xs font-medium text-[var(--glass-text-tertiary)] opacity-55"
        >
          <span className="flex items-center justify-center gap-1">
            <AppIcon name="cloudUpload" className="h-3.5 w-3.5" />
            {voiceT('uploadAudio')}
          </span>
        </button>

        <button
          type="button"
          disabled
          className="min-w-[80px] flex-1 cursor-not-allowed rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-1.5 text-xs font-medium text-[var(--glass-text-tertiary)] opacity-55"
        >
          <span className="flex items-center justify-center gap-1">
            <AppIcon name="bolt" className="h-3.5 w-3.5" />
            {voiceT('aiDesign')}
          </span>
        </button>

        {onSelectFromHub ? (
          <button
            type="button"
            onClick={() => onSelectFromHub(characterId)}
            className="min-w-[80px] flex-1 rounded-lg border border-[var(--glass-stroke-focus)] bg-[var(--glass-bg-surface)] px-2 py-1.5 text-xs font-medium text-[var(--glass-tone-info-fg)] transition-all hover:bg-[var(--glass-tone-info-bg)]"
          >
            <span className="flex items-center justify-center gap-1">
              <AppIcon name="copy" className="h-3.5 w-3.5" />
              {assetsT('assetLibrary.button')}
            </span>
          </button>
        ) : null}
      </div>

      <p
        id={descriptionId}
        className="mt-2 text-xs leading-relaxed text-[var(--glass-text-tertiary)]"
      >
        {voiceT('customSourceUnavailable')}
      </p>
    </div>
  )
}
