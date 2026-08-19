'use client'

import { useTranslations } from 'next-intl'
import type { StoryboardEpisodeAppearanceGate } from './storyboard-episode-appearance-policy'

export function StoryboardEpisodeAppearanceNotice({
  gate,
  onRetry,
}: {
  gate: StoryboardEpisodeAppearanceGate
  onRetry: () => void
}) {
  const t = useTranslations('v2Storyboard.appearanceGate')
  if (gate.status === 'ready') return null

  const message = gate.status === 'loading'
    ? t('loading')
    : gate.status === 'error'
      ? t('error')
      : gate.status === 'binding-missing'
        ? t('bindingMissing', { character: gate.characterName })
        : gate.status === 'stale-binding'
          ? t('staleBinding', { character: gate.characterName })
          : t('noAppearance', { character: gate.characterName })

  return (
    <div
      role={gate.status === 'loading' ? 'status' : 'alert'}
      className="mt-4 flex flex-col gap-3 rounded-[12px] border border-[var(--production-gold)]/35 bg-[var(--production-gold)]/10 px-4 py-3 text-sm text-[var(--production-gold)] sm:flex-row sm:items-center sm:justify-between"
    >
      <span>{message}</span>
      {gate.status === 'error' ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-input border border-[var(--production-gold)]/45 px-4 font-semibold transition-colors hover:bg-[var(--production-gold)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
        >
          {t('retry')}
        </button>
      ) : null}
    </div>
  )
}
