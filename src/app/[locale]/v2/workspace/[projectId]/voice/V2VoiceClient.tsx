'use client'

/**
 * Phase 12.6 — v2 VoicePage.
 *
 * Minimum viable: filter rail (gender / emotion) on the left,
 * voice grid on the right. Wires to useGlobalVoices() so the
 * user can audition existing voices. Tuning sliders are visual
 * only for now (12.6.x will bind to panel-level voice config).
 */

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

// Filter values stay as Simplified Chinese literals because they match
// the `metadata.gender` / `metadata.emotion` strings stored in DB rows.
// Display labels come from the v2Voice namespace so en users see English
// chip labels while the equality check stays stable.
const GENDER_FILTERS: { key: string; labelKey: string }[] = [
  { key: '全部', labelKey: 'all' },
  { key: '女', labelKey: 'female' },
  { key: '男', labelKey: 'male' },
  { key: '童', labelKey: 'child' },
  { key: '群演', labelKey: 'group' },
  { key: '特殊', labelKey: 'special' },
]
const EMOTION_FILTERS: { key: string; labelKey: string }[] = [
  { key: '中性', labelKey: 'neutral' },
  { key: '欢快', labelKey: 'happy' },
  { key: '悲伤', labelKey: 'sad' },
  { key: '愤怒', labelKey: 'angry' },
  { key: '惊讶', labelKey: 'surprised' },
  { key: '神秘', labelKey: 'mysterious' },
  { key: '温柔', labelKey: 'tender' },
  { key: '庄严', labelKey: 'solemn' },
  { key: '俏皮', labelKey: 'playful' },
]

export function V2VoiceClient({ projectId: _projectId }: V2VoiceClientProps) {
  const t = useTranslations('v2Voice')
  const voicesQuery = useGlobalVoices(null)
  const voices = useMemo(
    () => (voicesQuery.data ?? []) as unknown as VoiceLike[],
    [voicesQuery.data],
  )

  const [genderFilter, setGenderFilter] = useState<string>('全部')
  const [emotionFilter, setEmotionFilter] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Pause + clear ref on unmount so audio doesn't keep playing after navigation.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  const filtered = useMemo(() => {
    return voices.filter((v) => {
      if (genderFilter !== '全部' && v.metadata?.gender && v.metadata.gender !== genderFilter) return false
      if (emotionFilter && v.metadata?.emotion && v.metadata.emotion !== emotionFilter) return false
      return true
    })
  }, [voices, genderFilter, emotionFilter])

  function handlePlay(id: string, audioUrl: string | null | undefined) {
    if (!audioUrl) return
    // Stop any audio currently playing (single-track behaviour).
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (playingId === id) {
      setPlayingId(null)
      return
    }
    const audio = new Audio(audioUrl)
    audio.onended = () => {
      setPlayingId((current) => (current === id ? null : current))
      if (audioRef.current === audio) audioRef.current = null
    }
    audio.onerror = () => {
      setPlayingId((current) => (current === id ? null : current))
      if (audioRef.current === audio) audioRef.current = null
    }
    audioRef.current = audio
    void audio.play().catch(() => {
      setPlayingId((current) => (current === id ? null : current))
      if (audioRef.current === audio) audioRef.current = null
    })
    setPlayingId(id)
  }

  return (
    <div className="px-12 py-10">
      <div className="grid grid-cols-3 gap-8">
        {/* Filter rail */}
        <div className="col-span-1 space-y-6">
          <div>
            <div className="mb-3 font-mono text-[14px] tracking-wider text-amber-600">{t('filters.genderTitle')}</div>
            <div className="grid grid-cols-3 gap-2">
              {GENDER_FILTERS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGenderFilter(g.key)}
                  className={`rounded-sm border px-3 py-2 font-serif-cn text-xs transition-all ${
                    g.key === genderFilter
                      ? 'border-amber-500/50 bg-amber-500/5 text-amber-400'
                      : 'border-stone-800 text-stone-500 hover:border-stone-700'
                  }`}
                >
                  {t(`filters.gender.${g.labelKey}` as `filters.gender.${'all' | 'female' | 'male' | 'child' | 'group' | 'special'}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 font-mono text-[14px] tracking-wider text-amber-600">{t('filters.emotionTitle')}</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setEmotionFilter(null)}
                className={`rounded-sm border px-2.5 py-1.5 font-serif-cn text-xs transition-all ${
                  emotionFilter === null
                    ? 'border-amber-500/50 bg-amber-500/5 text-amber-400'
                    : 'border-stone-800 text-stone-500'
                }`}
              >
                {t('filters.gender.all')}
              </button>
              {EMOTION_FILTERS.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => setEmotionFilter(emotionFilter === e.key ? null : e.key)}
                  className={`rounded-sm border px-2.5 py-1.5 font-serif-cn text-xs transition-all ${
                    emotionFilter === e.key
                      ? 'border-amber-500/50 bg-amber-500/5 text-amber-400'
                      : 'border-stone-800 text-stone-500'
                  }`}
                >
                  {t(`filters.emotion.${e.labelKey}` as `filters.emotion.${'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'mysterious' | 'tender' | 'solemn' | 'playful'}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-sm border border-amber-900/20 bg-stone-900/40 p-4">
            <div className="mb-3 font-fraunces text-sm italic text-amber-500/80">Tuning</div>
            <p className="font-serif-cn text-xs leading-relaxed text-stone-500">
              {t('voice.controlsHint')}
            </p>
          </div>
        </div>

        {/* Voice grid */}
        <div className="col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="font-fraunces text-sm italic text-amber-500/80">{t('header.title')}</div>
            <div className="font-mono text-[14px] tracking-wider text-stone-500">
              {voices.length} VOICES · {filtered.length} SHOWING
            </div>
          </div>

          {voicesQuery.isLoading ? (
            <p className="font-mono text-xs tracking-wider text-stone-500">{t('header.loading')}</p>
          ) : filtered.length === 0 ? (
            <div className="rounded-sm border border-stone-800/50 bg-stone-900/30 p-12 text-center">
              <p className="font-fraunces text-base italic text-stone-400">
                {voices.length === 0 ? t('empty.noVoices') : t('empty.noMatches')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((v) => {
                const selected = selectedId === v.id
                const playing = playingId === v.id
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className={`group flex items-center gap-4 rounded-sm border px-4 py-4 text-left transition-all ${
                      selected
                        ? 'border-amber-500/60 bg-amber-500/5'
                        : 'border-stone-800/60 bg-stone-900/30 hover:border-stone-700'
                    }`}
                  >
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        handlePlay(v.id, v.audioUrl)
                      }}
                      className={`flex h-12 w-12 flex-shrink-0 cursor-pointer items-center justify-center rounded-full ${
                        selected ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-300'
                      }`}
                    >
                      <AppIcon name={playing ? 'pause' : 'play'} className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <div className={`font-serif-cn text-base ${selected ? 'text-amber-100' : 'text-stone-200'}`}>
                          {v.name ?? t('voice.untitled')}
                        </div>
                        {v.metadata?.gender ? (
                          <div className="font-mono text-[14px] tracking-wider text-stone-600">
                            {v.metadata.gender} · {v.metadata.age ?? '—'}
                          </div>
                        ) : null}
                      </div>
                      {v.description ? (
                        <div className="mt-1 line-clamp-1 font-fraunces text-xs italic text-stone-500">
                          {v.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
