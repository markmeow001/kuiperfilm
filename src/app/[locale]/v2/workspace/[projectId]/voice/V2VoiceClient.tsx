'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useGlobalVoices } from '@/lib/query/hooks/useGlobalAssets'

interface V2VoiceClientProps {
  projectId: string
}

interface VoiceLike {
  id: string
  name?: string | null
  description?: string | null
  audioUrl?: string | null
  metadata?: { gender?: string; age?: string; emotion?: string } | null
}

const GENDER_FILTERS = [
  { key: '全部', labelKey: 'all' },
  { key: '女', labelKey: 'female' },
  { key: '男', labelKey: 'male' },
  { key: '童', labelKey: 'child' },
  { key: '群演', labelKey: 'group' },
  { key: '特殊', labelKey: 'special' },
] as const

const EMOTION_FILTERS = [
  { key: '中性', labelKey: 'neutral' },
  { key: '欢快', labelKey: 'happy' },
  { key: '悲伤', labelKey: 'sad' },
  { key: '愤怒', labelKey: 'angry' },
  { key: '惊讶', labelKey: 'surprised' },
  { key: '神秘', labelKey: 'mysterious' },
  { key: '温柔', labelKey: 'tender' },
  { key: '庄严', labelKey: 'solemn' },
  { key: '俏皮', labelKey: 'playful' },
] as const

type GenderLabelKey = (typeof GENDER_FILTERS)[number]['labelKey']
type EmotionLabelKey = (typeof EMOTION_FILTERS)[number]['labelKey']

export function V2VoiceClient({ projectId: _projectId }: V2VoiceClientProps) {
  const t = useTranslations('v2Voice')
  const voicesQuery = useGlobalVoices(null)
  const voices = useMemo(
    () => (voicesQuery.data ?? []) as unknown as VoiceLike[],
    [voicesQuery.data],
  )
  const [genderFilter, setGenderFilter] = useState('全部')
  const [emotionFilter, setEmotionFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [playbackErrorId, setPlaybackErrorId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return voices.filter((voice) => {
      if (genderFilter !== '全部' && voice.metadata?.gender !== genderFilter) return false
      if (emotionFilter && voice.metadata?.emotion !== emotionFilter) return false
      if (!query) return true
      const haystack = [voice.name, voice.description, voice.metadata?.age, voice.metadata?.gender]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
      return haystack.includes(query)
    })
  }, [emotionFilter, genderFilter, search, voices])

  const selectedVoice = voices.find((voice) => voice.id === selectedId) ?? null
  const previewCount = voices.filter((voice) => Boolean(voice.audioUrl)).length
  const hasFilters = genderFilter !== '全部' || emotionFilter !== null || search.trim().length > 0

  function resetFilters() {
    setGenderFilter('全部')
    setEmotionFilter(null)
    setSearch('')
  }

  function handlePlay(voice: VoiceLike) {
    if (!voice.audioUrl) return
    audioRef.current?.pause()
    audioRef.current = null
    setPlaybackErrorId(null)

    if (playingId === voice.id) {
      setPlayingId(null)
      return
    }

    const audio = new Audio(voice.audioUrl)
    audio.onended = () => {
      setPlayingId((current) => (current === voice.id ? null : current))
      if (audioRef.current === audio) audioRef.current = null
    }
    audio.onerror = () => {
      setPlayingId((current) => (current === voice.id ? null : current))
      setPlaybackErrorId(voice.id)
      if (audioRef.current === audio) audioRef.current = null
    }
    audioRef.current = audio
    setPlayingId(voice.id)
    void audio.play().catch(() => {
      setPlayingId((current) => (current === voice.id ? null : current))
      setPlaybackErrorId(voice.id)
      if (audioRef.current === audio) audioRef.current = null
    })
  }

  return (
    <main className="kuiper-workspace-page mx-auto w-full max-w-[1800px] px-[var(--workspace-gutter)] py-6 sm:py-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-border-soft pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 font-mono text-[12px] uppercase tracking-[0.18em] text-primary-300">
            {t('page.eyebrow')}
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
            {t('page.title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary sm:text-base">
            {t('page.subtitle')}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <div className="kuiper-surface-card min-w-0 px-3 py-2.5 sm:min-w-[112px]">
            <div className="font-mono text-lg text-text-primary">{voices.length}</div>
            <div className="text-[12px] text-text-tertiary">{t('summary.total')}</div>
          </div>
          <div className="kuiper-surface-card min-w-0 px-3 py-2.5 sm:min-w-[112px]">
            <div className="font-mono text-lg text-emerald-300">{previewCount}</div>
            <div className="text-[12px] text-text-tertiary">{t('summary.previewable')}</div>
          </div>
          <div className="kuiper-surface-card min-w-0 px-3 py-2.5 sm:min-w-[112px]">
            <div className="font-mono text-lg text-primary-300">{filtered.length}</div>
            <div className="text-[12px] text-text-tertiary">{t('summary.showing')}</div>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <aside className="kuiper-surface-card h-fit p-4 xl:sticky xl:top-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-sm font-semibold text-text-primary">{t('filters.title')}</h2>
            {hasFilters ? (
              <button type="button" onClick={resetFilters} className="text-xs text-primary-300 hover:text-primary-200">
                {t('filters.reset')}
              </button>
            ) : null}
          </div>
          <label className="block">
            <span className="sr-only">{t('filters.search')}</span>
            <div className="relative">
              <AppIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('filters.search')}
                className="kuiper-input w-full py-2.5 pl-9 pr-3 text-sm"
              />
            </div>
          </label>

          <div className="mt-5">
            <div className="mb-2 text-xs font-medium text-text-secondary">{t('filters.genderTitle')}</div>
            <div className="grid grid-cols-3 gap-1.5">
              {GENDER_FILTERS.map((filter) => {
                const active = filter.key === genderFilter
                return (
                  <button
                    key={filter.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setGenderFilter(filter.key)}
                    className={`rounded-[var(--r-input)] border px-2 py-2 text-xs transition-colors ${
                      active
                        ? 'border-primary-500/50 bg-primary-500/15 text-primary-200'
                        : 'border-border-soft bg-surface-inset text-text-secondary hover:border-border-primary hover:text-text-primary'
                    }`}
                  >
                    {t(`filters.gender.${filter.labelKey}` as `filters.gender.${GenderLabelKey}`)}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-xs font-medium text-text-secondary">{t('filters.emotionTitle')}</div>
            <div className="flex flex-wrap gap-1.5">
              {EMOTION_FILTERS.map((filter) => {
                const active = filter.key === emotionFilter
                return (
                  <button
                    key={filter.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setEmotionFilter(active ? null : filter.key)}
                    className={`rounded-full border px-2.5 py-1.5 text-xs transition-colors ${
                      active
                        ? 'border-primary-500/50 bg-primary-500/15 text-primary-200'
                        : 'border-border-soft text-text-tertiary hover:border-border-primary hover:text-text-secondary'
                    }`}
                  >
                    {t(`filters.emotion.${filter.labelKey}` as `filters.emotion.${EmotionLabelKey}`)}
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        <section aria-labelledby="voice-library-title" className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="voice-library-title" className="font-heading text-base font-semibold text-text-primary">
              {t('header.title')}
            </h2>
            <span className="font-mono text-[12px] text-text-tertiary">
              {t('header.resultCount', { count: filtered.length })}
            </span>
          </div>

          {voicesQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="kuiper-surface-card h-[106px] animate-pulse bg-surface-raised" />
              ))}
            </div>
          ) : voicesQuery.isError ? (
            <div className="kuiper-surface-card border-rose-500/30 p-8 text-center">
              <AppIcon name="alertCircle" className="mx-auto h-6 w-6 text-rose-300" />
              <p className="mt-3 text-sm text-text-primary">{t('empty.loadFailed')}</p>
              <button type="button" onClick={() => void voicesQuery.refetch()} className="kuiper-secondary-button mt-4 px-4 py-2 text-sm">
                {t('empty.retry')}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="kuiper-surface-card p-10 text-center">
              <AppIcon name="audioWaveform" className="mx-auto h-7 w-7 text-text-tertiary" />
              <p className="mt-3 text-sm text-text-secondary">
                {voices.length === 0 ? t('empty.noVoices') : t('empty.noMatches')}
              </p>
              {hasFilters ? (
                <button type="button" onClick={resetFilters} className="kuiper-secondary-button mt-4 px-4 py-2 text-sm">
                  {t('filters.reset')}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((voice) => {
                const selected = selectedId === voice.id
                const playing = playingId === voice.id
                const playbackFailed = playbackErrorId === voice.id
                return (
                  <article
                    key={voice.id}
                    className={`kuiper-surface-card flex min-w-0 items-center gap-3 p-3 transition-colors ${
                      selected ? 'border-primary-500/60 bg-primary-500/[0.08]' : 'hover:border-border-primary'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!voice.audioUrl}
                      onClick={() => handlePlay(voice)}
                      aria-label={playing ? t('voice.pausePreview') : t('voice.playPreview', { name: voice.name ?? t('voice.untitled') })}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        playing
                          ? 'border-primary-400 bg-primary-500 text-black'
                          : 'border-border-primary bg-surface-overlay text-text-primary hover:border-primary-500/60 hover:text-primary-200'
                      }`}
                    >
                      <AppIcon name={playing ? 'pause' : 'play'} className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setSelectedId(voice.id)} className="min-w-0 flex-1 py-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-text-primary sm:text-base">
                          {voice.name ?? t('voice.untitled')}
                        </span>
                        {selected ? (
                          <span className="rounded-full bg-primary-500/15 px-2 py-0.5 text-[11px] text-primary-200">
                            {t('voice.selected')}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
                        {voice.metadata?.gender ? <span>{voice.metadata.gender}</span> : null}
                        {voice.metadata?.age ? <span>· {voice.metadata.age}</span> : null}
                        {voice.metadata?.emotion ? <span>· {voice.metadata.emotion}</span> : null}
                      </div>
                      {voice.description ? <p className="mt-1.5 line-clamp-1 text-xs text-text-secondary">{voice.description}</p> : null}
                      {playbackFailed ? <p className="mt-1.5 text-xs text-rose-300">{t('voice.playbackFailed')}</p> : null}
                    </button>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <aside className="kuiper-surface-card h-fit p-4 xl:sticky xl:top-4">
          <div className="mb-4 flex items-center gap-2 border-b border-border-soft pb-3">
            <AppIcon name="sliders" className="h-4 w-4 text-primary-300" />
            <h2 className="font-heading text-sm font-semibold text-text-primary">{t('inspector.title')}</h2>
          </div>
          {selectedVoice ? (
            <div>
              <div className="flex h-20 items-center justify-center rounded-[var(--r-card)] border border-border-soft bg-surface-inset">
                <AppIcon name="audioWaveform" className="h-8 w-8 text-primary-300" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-text-primary">{selectedVoice.name ?? t('voice.untitled')}</h3>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                {selectedVoice.description || t('inspector.noDescription')}
              </p>
              <dl className="mt-4 divide-y divide-border-soft border-y border-border-soft">
                <div className="flex items-center justify-between py-2.5 text-sm">
                  <dt className="text-text-tertiary">{t('inspector.gender')}</dt>
                  <dd className="text-text-primary">{selectedVoice.metadata?.gender ?? '—'}</dd>
                </div>
                <div className="flex items-center justify-between py-2.5 text-sm">
                  <dt className="text-text-tertiary">{t('inspector.age')}</dt>
                  <dd className="text-text-primary">{selectedVoice.metadata?.age ?? '—'}</dd>
                </div>
                <div className="flex items-center justify-between py-2.5 text-sm">
                  <dt className="text-text-tertiary">{t('inspector.emotion')}</dt>
                  <dd className="text-text-primary">{selectedVoice.metadata?.emotion ?? '—'}</dd>
                </div>
                <div className="flex items-center justify-between py-2.5 text-sm">
                  <dt className="text-text-tertiary">{t('inspector.preview')}</dt>
                  <dd className={selectedVoice.audioUrl ? 'text-emerald-300' : 'text-text-tertiary'}>
                    {selectedVoice.audioUrl ? t('inspector.ready') : t('inspector.unavailable')}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                disabled={!selectedVoice.audioUrl}
                onClick={() => handlePlay(selectedVoice)}
                className="kuiper-primary-button mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--r-input)] px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AppIcon name={playingId === selectedVoice.id ? 'pause' : 'play'} className="h-4 w-4" />
                {playingId === selectedVoice.id ? t('voice.pausePreview') : t('inspector.play')}
              </button>
            </div>
          ) : (
            <div className="py-8 text-center">
              <AppIcon name="cursor" className="mx-auto h-6 w-6 text-text-tertiary" />
              <p className="mt-3 text-sm leading-6 text-text-secondary">{t('inspector.empty')}</p>
            </div>
          )}
          <div className="mt-4 rounded-[var(--r-card)] border border-primary-500/20 bg-primary-500/[0.06] p-3 text-xs leading-5 text-text-secondary">
            {t('voice.controlsHint')}
          </div>
        </aside>
      </div>
    </main>
  )
}
