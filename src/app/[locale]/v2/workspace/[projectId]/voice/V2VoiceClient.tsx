'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useGlobalVoices } from '@/lib/query/hooks/useGlobalAssets'
import { useProjectCharacters } from '@/lib/query/hooks/useProjectAssets'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { useVoiceTaskPresentation } from '@/lib/query/hooks/useTaskPresentation'
import {
  useAnalyzeProjectVoice,
  useDownloadProjectVoices,
  useGenerateProjectVoice,
  useUpdateProjectVoiceLine,
  useUpdateSpeakerVoice,
} from '@/lib/query/mutations/useVoiceMutations'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { VoiceInspector } from './VoiceInspector'
import { VoiceLibrary } from './VoiceLibrary'
import { VoiceLinePanel } from './VoiceLinePanel'
import { VoiceSpeakerRail } from './VoiceSpeakerRail'
import { useAudioPreview } from './useAudioPreview'
import { useVoiceWorkspaceData } from './useVoiceWorkspaceData'
import {
  collectEpisodeSpeakers,
  countGeneratableLines,
  filterVoiceAssets,
  getVoicePreviewUrl,
} from './voice-workspace-helpers'
import type {
  SpeakerVoiceEntry,
  VoiceAsset,
  VoiceLine,
  VoiceLineSavePayload,
} from './voice-workspace-types'

interface V2VoiceClientProps {
  projectId: string
}

const GENDER_FILTERS = [
  { key: '全部', labelKey: 'all' },
  { key: '女', labelKey: 'female' },
  { key: '男', labelKey: 'male' },
  { key: '童', labelKey: 'child' },
  { key: '群演', labelKey: 'group' },
  { key: '特殊', labelKey: 'special' },
] as const

type GenderLabelKey = (typeof GENDER_FILTERS)[number]['labelKey']

const EMPTY_VOICE_LINES: VoiceLine[] = []
const EMPTY_SPEAKER_VOICES: Record<string, SpeakerVoiceEntry> = {}
const EMPTY_VOICE_ASSETS: VoiceAsset[] = []
const EMPTY_SPEAKERS: string[] = []

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function V2VoiceClient({ projectId }: V2VoiceClientProps) {
  const t = useTranslations('v2Voice')
  const { currentEpisodeId } = useCurrentEpisode(projectId)
  const { canEdit } = useProjectAccess(projectId)
  const stageQuery = useVoiceWorkspaceData(projectId, currentEpisodeId)
  const voicesQuery = useGlobalVoices(null)
  const charactersQuery = useProjectCharacters(projectId)
  const analyzeVoice = useAnalyzeProjectVoice(projectId)
  const generateVoice = useGenerateProjectVoice(projectId)
  const updateSpeakerVoice = useUpdateSpeakerVoice(projectId)
  const updateVoiceLine = useUpdateProjectVoiceLine(projectId)
  const downloadVoices = useDownloadProjectVoices(projectId)
  const audioPreview = useAudioPreview()

  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string | null>(null)
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState('全部')
  const [actionError, setActionError] = useState<string | null>(null)
  const [savingLineId, setSavingLineId] = useState<string | null>(null)
  const [submittingLineIds, setSubmittingLineIds] = useState<Set<string>>(new Set())

  const workspace = stageQuery.data
  const voiceLines = workspace?.voiceLines ?? EMPTY_VOICE_LINES
  const speakerVoices = workspace?.speakerVoices ?? EMPTY_SPEAKER_VOICES
  const voices = voicesQuery.data ?? EMPTY_VOICE_ASSETS
  const projectSpeakers = workspace?.speakers ?? EMPTY_SPEAKERS
  const speakers = useMemo(
    () => collectEpisodeSpeakers(voiceLines, projectSpeakers),
    [projectSpeakers, voiceLines],
  )
  const selectedSpeaker = selectedSpeakerId && speakers.includes(selectedSpeakerId)
    ? selectedSpeakerId
    : speakers[0] ?? null
  const filteredVoices = useMemo(
    () => filterVoiceAssets(voices, search, genderFilter),
    [genderFilter, search, voices],
  )
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) ?? null

  const characterVoiceBySpeaker = useMemo(() => {
    const map = new Map<string, string>()
    for (const character of charactersQuery.data ?? []) {
      if (character.customVoiceUrl) map.set(character.name.trim(), character.customVoiceUrl)
    }
    return map
  }, [charactersQuery.data])
  const boundSpeakers = useMemo(() => {
    const bound = new Set<string>()
    for (const speaker of speakers) {
      if (speakerVoices[speaker]?.audioUrl || characterVoiceBySpeaker.has(speaker)) bound.add(speaker)
    }
    return bound
  }, [characterVoiceBySpeaker, speakerVoices, speakers])

  const voiceTaskTargets = useMemo(
    () => voiceLines.map((line) => ({
      key: line.id,
      targetType: 'NovelPromotionVoiceLine',
      targetId: line.id,
      types: ['voice_line'],
      resource: 'audio' as const,
      hasOutput: Boolean(line.audioUrl),
    })),
    [voiceLines],
  )
  const voiceTaskPresentation = useVoiceTaskPresentation(projectId, voiceTaskTargets, {
    enabled: voiceTaskTargets.length > 0,
    staleTime: 3000,
  })
  const readyLineCount = voiceLines.filter((line) => Boolean(line.audioUrl)).length
  const boundSpeakerCount = speakers.filter((speaker) => boundSpeakers.has(speaker)).length
  const generatableLineCount = countGeneratableLines(voiceLines, boundSpeakers)
  const currentBinding = selectedSpeaker ? speakerVoices[selectedSpeaker] ?? null : null
  const currentBindingName = currentBinding?.voiceId
    ? voices.find((voice) => voice.voiceId === currentBinding.voiceId)?.name ?? null
    : selectedSpeaker && characterVoiceBySpeaker.has(selectedSpeaker)
      ? t('inspector.projectCharacterVoice')
      : null
  const hasFilters = search.trim().length > 0 || genderFilter !== '全部'

  function resetFilters() {
    setSearch('')
    setGenderFilter('全部')
  }

  async function bindSelectedVoice() {
    if (!currentEpisodeId || !selectedSpeaker || !selectedVoice) return
    const previewUrl = getVoicePreviewUrl(selectedVoice)
    if (!previewUrl) {
      setActionError(t('errors.voiceHasNoPreview'))
      return
    }
    setActionError(null)
    try {
      await updateSpeakerVoice.mutateAsync({
        episodeId: currentEpisodeId,
        speaker: selectedSpeaker,
        audioUrl: previewUrl,
        voiceType: selectedVoice.voiceType,
        ...(selectedVoice.voiceId ? { voiceId: selectedVoice.voiceId } : {}),
      })
      await stageQuery.refetch()
    } catch (error) {
      setActionError(errorMessage(error, t('errors.bindFailed')))
    }
  }

  async function analyzeDialogue() {
    if (!currentEpisodeId) return
    if (voiceLines.length > 0 && !window.confirm(t('actions.reanalyzeConfirm'))) return
    setActionError(null)
    try {
      await analyzeVoice.mutateAsync({ episodeId: currentEpisodeId })
      await stageQuery.refetch()
    } catch (error) {
      setActionError(errorMessage(error, t('errors.analyzeFailed')))
    }
  }

  async function generateLine(lineId: string) {
    if (!currentEpisodeId) return
    setActionError(null)
    setSubmittingLineIds((current) => new Set(current).add(lineId))
    try {
      await generateVoice.mutateAsync({ episodeId: currentEpisodeId, lineId })
      await stageQuery.refetch()
    } catch (error) {
      setActionError(errorMessage(error, t('errors.generateFailed')))
    } finally {
      setSubmittingLineIds((current) => {
        const next = new Set(current)
        next.delete(lineId)
        return next
      })
    }
  }

  async function generateAll() {
    if (!currentEpisodeId || generatableLineCount === 0) return
    const lineIds = voiceLines
      .filter((line) => !line.audioUrl && boundSpeakers.has(line.speaker))
      .map((line) => line.id)
    setActionError(null)
    setSubmittingLineIds(new Set(lineIds))
    try {
      await generateVoice.mutateAsync({ episodeId: currentEpisodeId, all: true })
      await stageQuery.refetch()
    } catch (error) {
      setActionError(errorMessage(error, t('errors.batchFailed')))
    } finally {
      setSubmittingLineIds(new Set())
    }
  }

  async function saveLineEmotion(payload: VoiceLineSavePayload) {
    setActionError(null)
    setSavingLineId(payload.lineId)
    try {
      await updateVoiceLine.mutateAsync(payload)
      await stageQuery.refetch()
    } catch (error) {
      setActionError(errorMessage(error, t('errors.saveEmotionFailed')))
    } finally {
      setSavingLineId(null)
    }
  }

  async function downloadAll() {
    if (!currentEpisodeId || readyLineCount === 0) return
    setActionError(null)
    try {
      const blob = await downloadVoices.mutateAsync({ episodeId: currentEpisodeId })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `voices-${currentEpisodeId}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      setActionError(errorMessage(error, t('errors.downloadFailed')))
    }
  }

  return (
    <main className="kuiper-workspace-page mx-auto w-full max-w-[1800px] px-[var(--workspace-gutter)] py-6 sm:py-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-border-soft pb-5 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <div className="mb-2 font-mono text-[12px] uppercase tracking-[0.18em] text-primary-300">{t('page.eyebrow')}</div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">{t('page.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary sm:text-base">{t('page.functionalSubtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!currentEpisodeId || analyzeVoice.isPending || !canEdit}
            onClick={() => void analyzeDialogue()}
            className="kuiper-secondary-button inline-flex items-center gap-2 px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AppIcon name={analyzeVoice.isPending ? 'loader' : 'fileText'} className={`h-4 w-4 ${analyzeVoice.isPending ? 'animate-spin' : ''}`} />
            {analyzeVoice.isPending ? t('actions.analyzing') : voiceLines.length > 0 ? t('actions.reanalyze') : t('actions.analyze')}
          </button>
          <button
            type="button"
            disabled={generatableLineCount === 0 || generateVoice.isPending || !canEdit}
            onClick={() => void generateAll()}
            title={generatableLineCount === 0 ? t('actions.noGeneratableLines') : undefined}
            className="kuiper-primary-button inline-flex items-center gap-2 rounded-[var(--r-input)] px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AppIcon name={generateVoice.isPending ? 'loader' : 'sparklesAlt'} className={`h-4 w-4 ${generateVoice.isPending ? 'animate-spin' : ''}`} />
            {generateVoice.isPending ? t('actions.submitting') : t('actions.generateAll', { count: generatableLineCount })}
          </button>
          <button
            type="button"
            disabled={readyLineCount === 0 || downloadVoices.isPending}
            onClick={() => void downloadAll()}
            className="kuiper-secondary-button inline-flex items-center gap-2 px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AppIcon name={downloadVoices.isPending ? 'loader' : 'download'} className={`h-4 w-4 ${downloadVoices.isPending ? 'animate-spin' : ''}`} />
            {downloadVoices.isPending ? t('actions.downloading') : t('actions.downloadAll')}
          </button>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { value: speakers.length, label: t('summary.speakers'), tone: 'text-text-primary' },
          { value: `${boundSpeakerCount}/${speakers.length}`, label: t('summary.bound'), tone: 'text-emerald-300' },
          { value: voiceLines.length, label: t('summary.lines'), tone: 'text-text-primary' },
          { value: `${readyLineCount}/${voiceLines.length}`, label: t('summary.generated'), tone: 'text-primary-300' },
        ].map((item) => (
          <div key={item.label} className="kuiper-surface-card px-3 py-2.5">
            <div className={`font-mono text-lg ${item.tone}`}>{item.value}</div>
            <div className="text-[12px] text-text-tertiary">{item.label}</div>
          </div>
        ))}
      </div>

      {actionError || stageQuery.isError ? (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-[var(--r-card)] border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AppIcon name="alertCircle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{actionError || errorMessage(stageQuery.error, t('errors.loadStageFailed'))}</span>
          <button type="button" onClick={() => { setActionError(null); void stageQuery.refetch() }} className="shrink-0 text-xs underline underline-offset-2">
            {t('empty.retry')}
          </button>
        </div>
      ) : null}

      <div className="grid min-h-0 gap-4 xl:grid-cols-[250px_minmax(0,1fr)_310px]">
        <VoiceSpeakerRail
          speakers={speakers}
          selectedSpeaker={selectedSpeaker}
          speakerStats={workspace?.speakerStats ?? {}}
          boundSpeakers={boundSpeakers}
          onSelect={setSelectedSpeakerId}
        />

        <section aria-labelledby="voice-library-title" className="min-w-0">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 id="voice-library-title" className="font-heading text-base font-semibold text-text-primary">{t('header.title')}</h2>
              <p className="mt-1 text-xs text-text-tertiary">{t('header.assignHint', { speaker: selectedSpeaker || t('header.noSpeaker') })}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative block min-w-[220px]">
                <span className="sr-only">{t('filters.search')}</span>
                <AppIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('filters.search')} className="kuiper-input w-full py-2 pl-9 pr-3 text-sm" />
              </label>
              <select value={genderFilter} onChange={(event) => setGenderFilter(event.target.value)} className="kuiper-input min-w-[120px] px-3 py-2 text-sm">
                {GENDER_FILTERS.map((filter) => (
                  <option key={filter.key} value={filter.key}>{t(`filters.gender.${filter.labelKey}` as `filters.gender.${GenderLabelKey}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <VoiceLibrary
            voices={filteredVoices}
            isLoading={voicesQuery.isLoading}
            isError={voicesQuery.isError}
            selectedVoiceId={selectedVoiceId}
            playingKey={audioPreview.playingKey}
            errorKey={audioPreview.errorKey}
            onSelect={setSelectedVoiceId}
            onTogglePreview={audioPreview.toggle}
            onRetry={() => void voicesQuery.refetch()}
            onResetFilters={resetFilters}
            hasFilters={hasFilters}
          />
        </section>

        <VoiceInspector
          selectedVoice={selectedVoice}
          selectedSpeaker={selectedSpeaker}
          currentBinding={currentBinding}
          currentBindingName={currentBindingName}
          isSpeakerBound={selectedSpeaker ? boundSpeakers.has(selectedSpeaker) : false}
          playingKey={audioPreview.playingKey}
          isBinding={updateSpeakerVoice.isPending}
          canEdit={canEdit}
          onTogglePreview={audioPreview.toggle}
          onBind={() => void bindSelectedVoice()}
        />
      </div>

      {stageQuery.isLoading ? (
        <div className="mt-6 grid gap-3 2xl:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="kuiper-surface-card h-56 animate-pulse" />)}
        </div>
      ) : (
        <VoiceLinePanel
          voiceLines={voiceLines}
          taskStatesByLineId={voiceTaskPresentation.statesByKey}
          boundSpeakers={boundSpeakers}
          playingKey={audioPreview.playingKey}
          savingLineId={savingLineId}
          submittingLineIds={submittingLineIds}
          canEdit={canEdit}
          onTogglePreview={audioPreview.toggle}
          onGenerate={(lineId) => void generateLine(lineId)}
          onSave={(payload) => void saveLineEmotion(payload)}
        />
      )}
    </main>
  )
}
