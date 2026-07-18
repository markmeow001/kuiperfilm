'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
interface VoiceSpeakerRailProps {
  speakers: string[]
  selectedSpeaker: string | null
  speakerStats: Record<string, number>
  boundSpeakers: ReadonlySet<string>
  onSelect: (speaker: string) => void
}

export function VoiceSpeakerRail({
  speakers,
  selectedSpeaker,
  speakerStats,
  boundSpeakers,
  onSelect,
}: VoiceSpeakerRailProps) {
  const t = useTranslations('v2Voice')

  return (
    <aside className="kuiper-surface-card h-fit p-3 xl:sticky xl:top-4">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="font-heading text-sm font-semibold text-text-primary">{t('speakers.title')}</h2>
        <span className="font-mono text-[12px] text-text-tertiary">{speakers.length}</span>
      </div>
      {speakers.length === 0 ? (
        <div className="rounded-[var(--r-card)] border border-dashed border-border-soft px-3 py-8 text-center">
          <AppIcon name="mic" className="mx-auto h-5 w-5 text-text-tertiary" />
          <p className="mt-2 text-xs leading-5 text-text-tertiary">{t('speakers.empty')}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {speakers.map((speaker) => {
            const selected = selectedSpeaker === speaker
            const bound = boundSpeakers.has(speaker)
            return (
              <button
                key={speaker}
                type="button"
                onClick={() => onSelect(speaker)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-3 rounded-[var(--r-input)] border px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? 'border-primary-500/50 bg-primary-500/10'
                    : 'border-transparent hover:border-border-soft hover:bg-surface-inset'
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  bound ? 'bg-emerald-500/15 text-emerald-300' : 'bg-surface-overlay text-text-tertiary'
                }`}>
                  <AppIcon name={bound ? 'check' : 'user'} className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary">{speaker}</span>
                  <span className="mt-0.5 block text-[11px] text-text-tertiary">
                    {bound ? t('speakers.bound') : t('speakers.unbound')} · {t('speakers.lineCount', { count: speakerStats[speaker] || 0 })}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </aside>
  )
}
