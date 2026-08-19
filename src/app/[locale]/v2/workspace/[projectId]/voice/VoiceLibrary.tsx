'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { getVoicePreviewUrl } from './voice-workspace-helpers'
import type { VoiceAsset } from './voice-workspace-types'

interface VoiceLibraryProps {
  voices: VoiceAsset[]
  isLoading: boolean
  isError: boolean
  selectedVoiceId: string | null
  playingKey: string | null
  errorKey: string | null
  onSelect: (voiceId: string) => void
  onTogglePreview: (key: string, url: string | null) => void
  onRetry: () => void
  onResetFilters: () => void
  hasFilters: boolean
}

export function VoiceLibrary({
  voices,
  isLoading,
  isError,
  selectedVoiceId,
  playingKey,
  errorKey,
  onSelect,
  onTogglePreview,
  onRetry,
  onResetFilters,
  hasFilters,
}: VoiceLibraryProps) {
  const t = useTranslations('v2Voice')

  if (isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="kuiper-surface-card h-[106px] animate-pulse bg-surface-raised" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="kuiper-surface-card border-rose-500/30 p-8 text-center">
        <AppIcon name="alertCircle" className="mx-auto h-6 w-6 text-rose-300" />
        <p className="mt-3 text-sm text-text-primary">{t('empty.loadFailed')}</p>
        <button type="button" onClick={onRetry} className="kuiper-secondary-button mt-4 px-4 py-2 text-sm">
          {t('empty.retry')}
        </button>
      </div>
    )
  }

  if (voices.length === 0) {
    return (
      <div className="kuiper-surface-card p-10 text-center">
        <AppIcon name="audioWaveform" className="mx-auto h-7 w-7 text-text-tertiary" />
        <p className="mt-3 text-sm text-text-secondary">{hasFilters ? t('empty.noMatches') : t('empty.noVoices')}</p>
        {hasFilters ? (
          <button type="button" onClick={onResetFilters} className="kuiper-secondary-button mt-4 px-4 py-2 text-sm">
            {t('filters.reset')}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {voices.map((voice) => {
        const previewUrl = getVoicePreviewUrl(voice)
        const previewKey = `asset:${voice.id}`
        const selected = selectedVoiceId === voice.id
        const playing = playingKey === previewKey
        return (
          <article
            key={voice.id}
            className={`kuiper-surface-card flex min-w-0 items-center gap-3 p-3 transition-colors ${
              selected ? 'border-primary-500/60 bg-primary-500/[0.08]' : 'hover:border-border-primary'
            }`}
          >
            <button
              type="button"
              disabled={!previewUrl}
              onClick={() => onTogglePreview(previewKey, previewUrl)}
              aria-label={playing ? t('voice.pausePreview') : t('voice.playPreview', { name: voice.name })}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                playing
                  ? 'border-primary-400 bg-primary-500 text-black'
                  : 'border-border-primary bg-surface-overlay text-text-primary hover:border-primary-500/60 hover:text-primary-200'
              }`}
            >
              <AppIcon name={playing ? 'pause' : 'play'} className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onSelect(voice.id)} className="min-w-0 flex-1 py-1 text-left">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-text-primary sm:text-base">{voice.name}</span>
                {selected ? (
                  <span className="rounded-full bg-primary-500/15 px-2 py-0.5 text-[11px] text-primary-200">{t('voice.selected')}</span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
                {voice.gender ? <span>{voice.gender}</span> : null}
                <span>· {t('voice.systemPreset')}</span>
              </div>
              {voice.description ? <p className="mt-1.5 line-clamp-1 text-xs text-text-secondary">{voice.description}</p> : null}
              {errorKey === previewKey ? <p className="mt-1.5 text-xs text-rose-300">{t('voice.playbackFailed')}</p> : null}
            </button>
          </article>
        )
      })}
    </div>
  )
}
