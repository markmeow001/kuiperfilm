'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { getVoicePreviewUrl } from './voice-workspace-helpers'
import type { SpeakerVoiceEntry, VoiceAsset } from './voice-workspace-types'

interface VoiceInspectorProps {
  selectedVoice: VoiceAsset | null
  selectedSpeaker: string | null
  currentBinding: SpeakerVoiceEntry | null
  currentBindingName: string | null
  isSpeakerBound: boolean
  playingKey: string | null
  isBinding: boolean
  canEdit: boolean
  onTogglePreview: (key: string, url: string | null) => void
  onBind: () => void
}

export function VoiceInspector({
  selectedVoice,
  selectedSpeaker,
  currentBinding,
  currentBindingName,
  isSpeakerBound,
  playingKey,
  isBinding,
  canEdit,
  onTogglePreview,
  onBind,
}: VoiceInspectorProps) {
  const t = useTranslations('v2Voice')
  const previewUrl = selectedVoice ? getVoicePreviewUrl(selectedVoice) : null
  const previewKey = selectedVoice ? `asset:${selectedVoice.id}` : ''
  const isPlaying = previewKey.length > 0 && playingKey === previewKey
  const canBind = Boolean(selectedVoice && selectedSpeaker && previewUrl && canEdit)

  return (
    <aside className="kuiper-surface-card h-fit p-4 xl:sticky xl:top-4">
      <div className="mb-4 flex items-center gap-2 border-b border-border-soft pb-3">
        <AppIcon name="sliders" className="h-4 w-4 text-primary-300" />
        <h2 className="font-heading text-sm font-semibold text-text-primary">{t('inspector.title')}</h2>
      </div>

      {selectedSpeaker ? (
        <div className="mb-4 rounded-[var(--r-card)] border border-border-soft bg-surface-inset p-3">
          <div className="text-[11px] uppercase tracking-wider text-text-tertiary">{t('inspector.targetSpeaker')}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-text-primary">{selectedSpeaker}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
              isSpeakerBound ? 'bg-emerald-500/15 text-emerald-300' : 'bg-surface-overlay text-text-tertiary'
            }`}>
              {isSpeakerBound ? t('speakers.bound') : t('speakers.unbound')}
            </span>
          </div>
          {isSpeakerBound ? (
            <p className="mt-1.5 truncate text-xs text-text-tertiary">
              {currentBindingName || currentBinding?.voicePresetId || t('inspector.systemPreset')}
            </p>
          ) : null}
        </div>
      ) : null}

      {selectedVoice ? (
        <div>
          <div className="flex h-20 items-center justify-center rounded-[var(--r-card)] border border-border-soft bg-surface-inset">
            <AppIcon name="audioWaveform" className="h-8 w-8 text-primary-300" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">{selectedVoice.name}</h3>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{selectedVoice.description || t('inspector.noDescription')}</p>
          <dl className="mt-4 divide-y divide-border-soft border-y border-border-soft">
            <div className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-text-tertiary">{t('inspector.gender')}</dt>
              <dd className="text-text-primary">{selectedVoice.gender ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-text-tertiary">{t('inspector.type')}</dt>
              <dd className="max-w-[150px] truncate text-text-primary">{t('inspector.systemPreset')}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-text-tertiary">{t('inspector.preview')}</dt>
              <dd className={previewUrl ? 'text-emerald-300' : 'text-text-tertiary'}>
                {previewUrl ? t('inspector.ready') : t('inspector.unavailable')}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            disabled={!previewUrl}
            onClick={() => onTogglePreview(previewKey, previewUrl)}
            className="kuiper-secondary-button mt-4 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AppIcon name={isPlaying ? 'pause' : 'play'} className="h-4 w-4" />
            {isPlaying ? t('voice.pausePreview') : t('inspector.play')}
          </button>
          <button
            type="button"
            disabled={!canBind || isBinding}
            onClick={onBind}
            className="kuiper-primary-button mt-2 flex w-full items-center justify-center gap-2 rounded-[var(--r-input)] px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AppIcon name={isBinding ? 'loader' : 'link'} className={`h-4 w-4 ${isBinding ? 'animate-spin' : ''}`} />
            {isBinding ? t('inspector.binding') : selectedSpeaker ? t('inspector.bindTo', { speaker: selectedSpeaker }) : t('inspector.selectSpeakerFirst')}
          </button>
        </div>
      ) : (
        <div className="py-8 text-center">
          <AppIcon name="cursor" className="mx-auto h-6 w-6 text-text-tertiary" />
          <p className="mt-3 text-sm leading-6 text-text-secondary">{t('inspector.empty')}</p>
        </div>
      )}
    </aside>
  )
}
