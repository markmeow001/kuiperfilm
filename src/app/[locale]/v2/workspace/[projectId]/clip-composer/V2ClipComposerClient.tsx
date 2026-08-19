'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { PageHeader } from '@/components/v2/PageHeader'
import { StatusPill } from '@/components/v2/StatusPill'
import {
  MediaWorkspaceSurface,
  mediaWorkspaceClasses,
} from '@/components/v2/MediaWorkspaceSurface'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import {
  useStoryboards,
  type StoryboardPanel,
} from '@/lib/query/hooks/useStoryboards'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { useEpisodePreservingHref } from '../hooks/useEpisodePreservingHref'

interface V2ClipComposerClientProps {
  projectId: string
  locale: string
}

interface ProjectLike {
  novelPromotionData?: {
    videoRatio?: string | null
    targetDuration?: number | null
  } | null
}

interface ClipItem {
  id: string
  panel: StoryboardPanel
  number: number
}

type MobileMode = 'preview' | 'timeline' | 'media' | 'adjust'

const TOOL_ITEMS: readonly {
  id: string
  labelKey: 'media' | 'sound' | 'captions' | 'effects' | 'transitions'
  icon: AppIconName
}[] = [
  { id: 'media', labelKey: 'media', icon: 'film' },
  { id: 'sound', labelKey: 'sound', icon: 'audioWave' },
  { id: 'captions', labelKey: 'captions', icon: 'fileText' },
  { id: 'effects', labelKey: 'effects', icon: 'sparklesAlt' },
  { id: 'transitions', labelKey: 'transitions', icon: 'arrowRight' },
]

export function V2ClipComposerClient({
  projectId,
  locale,
}: V2ClipComposerClientProps) {
  const t = useTranslations('v2Production.clipComposer')
  const { currentEpisodeId, currentEpisode } = useCurrentEpisode(projectId)
  const buildHref = useEpisodePreservingHref()
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLike | undefined
  const storyboardsQuery = useStoryboards(projectId, currentEpisodeId)
  const [activeTool, setActiveTool] = useState('media')
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [mobileMode, setMobileMode] = useState<MobileMode>('preview')
  const activeToolItem = TOOL_ITEMS.find((item) => item.id === activeTool)

  const clips = useMemo<ClipItem[]>(() => {
    let number = 0
    return (storyboardsQuery.data?.storyboards ?? []).flatMap((group) =>
      group.panels
        .filter((panel) => Boolean(panel.videoUrl || panel.imageUrl))
        .map((panel) => {
          number += 1
          return { id: panel.id, panel, number }
        }),
    )
  }, [storyboardsQuery.data])
  const selectedClip =
    clips.find((clip) => clip.id === selectedClipId) ?? clips[0] ?? null
  const videoClips = clips.filter((clip) => Boolean(clip.panel.videoUrl))
  const ratio = project?.novelPromotionData?.videoRatio ?? t('notSet')
  const targetDuration = project?.novelPromotionData?.targetDuration ?? null
  const finalHref = buildHref(`/${locale}/v2/workspace/${projectId}/final`)
  const storyboardHref = buildHref(
    `/${locale}/v2/workspace/${projectId}/storyboard`,
  )
  const hasSourceError = projectQuery.isError || storyboardsQuery.isError
  const hasBlockingSourceError =
    (projectQuery.isError && !projectQuery.data) ||
    (storyboardsQuery.isError && !storyboardsQuery.data)
  const sourceErrorDetails: string[] = []
  if (projectQuery.isError) {
    sourceErrorDetails.push(
      projectQuery.error instanceof Error
        ? t('projectError', { message: projectQuery.error.message })
        : t('projectErrorUnknown'),
    )
  }
  if (storyboardsQuery.isError) {
    sourceErrorDetails.push(
      storyboardsQuery.error instanceof Error
        ? t('storyboardError', { message: storyboardsQuery.error.message })
        : t('storyboardErrorUnknown'),
    )
  }

  function retrySourceData() {
    if (projectQuery.isError) void projectQuery.refetch()
    if (storyboardsQuery.isError) void storyboardsQuery.refetch()
  }

  if (projectQuery.isLoading || storyboardsQuery.isLoading) {
    return (
      <MediaWorkspaceSurface>
        <div className="kuiper-workspace-page space-y-4" aria-busy="true">
          <div className="h-24 animate-pulse rounded-[var(--r-card)] bg-overlay" />
          <div className="h-[620px] animate-pulse rounded-[var(--r-card)] bg-overlay" />
        </div>
      </MediaWorkspaceSurface>
    )
  }

  return (
    <MediaWorkspaceSurface>
      <main className="kuiper-workspace-page mx-auto w-full max-w-[2000px] px-[var(--workspace-gutter)] py-6 pb-28 sm:py-8 lg:pb-8">
        <PageHeader
          tone="dark"
          className="border-b border-border-soft pb-5"
          eyebrow="CLIP COMPOSER"
          title={t('title')}
          description={t('description')}
          context={<span>{currentEpisode?.name ?? t('currentEpisode')}</span>}
          actions={
            <>
              {!storyboardsQuery.isError || storyboardsQuery.data ? (
                <StatusPill
                  label={t('videoCount', {
                    videos: videoClips.length,
                    clips: clips.length,
                  })}
                  tone={videoClips.length > 0 ? 'active' : 'neutral'}
                />
              ) : null}
              <Link
                href={finalHref}
                className={`${mediaWorkspaceClasses.deliverAction} inline-flex min-h-11 items-center gap-2 rounded-[var(--r-input)] border px-4 text-sm font-semibold transition-colors`}
              >
                {t('goToDelivery')}
                <AppIcon name="arrowRight" className="h-4 w-4" />
              </Link>
            </>
          }
        />

        <section className="mt-4 rounded-[var(--r-card)] border border-primary-500/20 bg-primary-500/5 px-4 py-3 text-sm leading-6 text-text-secondary">
          <strong className="text-primary-200">{t('boundaryLabel')}</strong>
          {t('boundary')}
        </section>

        {hasSourceError ? (
          <section
            role="alert"
            className="mt-5 rounded-[var(--r-card)] border border-rose-500/30 bg-rose-500/10 p-5"
          >
            <h2 className="font-semibold text-rose-100">
              {t('loadErrorTitle')}
            </h2>
            <p className="mt-1 text-sm leading-6 text-rose-200/80">
              {hasBlockingSourceError
                ? t('loadErrorBlocking')
                : t('loadErrorStale')}
            </p>
            <ul className="mt-3 space-y-1 text-xs leading-5 text-rose-200/75">
              {sourceErrorDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={retrySourceData}
              className="kuiper-secondary-button mt-4 min-h-11 px-4 text-sm"
            >
              {t('retry')}
            </button>
          </section>
        ) : null}

        {!hasBlockingSourceError ? (
          clips.length === 0 ? (
            <section className="mt-5 rounded-[var(--r-card)] border border-dashed border-border-soft bg-surface-raised p-8 text-center">
              <AppIcon
                name="film"
                className="mx-auto h-8 w-8 text-text-tertiary"
              />
              <h2 className="mt-3 text-lg font-semibold text-text-primary">
                {t('emptyTitle')}
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-text-secondary">
                {t('emptyDescription')}
              </p>
              <Link
                href={storyboardHref}
                className="kuiper-primary-button mt-5 inline-flex min-h-11 items-center gap-2 px-5 text-sm font-semibold"
              >
                {t('goToStoryboard')}
                <AppIcon name="arrowRight" className="h-4 w-4" />
              </Link>
            </section>
          ) : (
            <div
              className={`mt-5 overflow-hidden rounded-[var(--r-card)] border ${mediaWorkspaceClasses.editorFrame}`}
            >
              <div className="grid min-h-[640px] lg:grid-cols-[72px_280px_minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)_190px]">
                <nav
                  aria-label={t('toolsAria')}
                  className={`${mobileMode === 'media' ? 'flex' : 'hidden lg:flex'} ${mediaWorkspaceClasses.chrome} flex-col border-r border-border-soft p-2`}
                >
                  {TOOL_ITEMS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTool(item.id)}
                      aria-pressed={activeTool === item.id}
                      className={`mb-1 flex min-h-14 flex-col items-center justify-center gap-1 rounded-[var(--r-input)] px-1 text-[10px] transition-colors ${
                        activeTool === item.id
                          ? 'bg-primary-500/15 text-primary-200'
                          : 'text-text-tertiary hover:bg-overlay hover:text-text-primary'
                      }`}
                    >
                      <AppIcon name={item.icon} className="h-4 w-4" />
                      {t(item.labelKey)}
                    </button>
                  ))}
                </nav>

                <aside
                  className={`${mobileMode === 'media' ? 'block' : 'hidden lg:block'} min-w-0 border-r border-border-soft bg-surface-raised`}
                >
                  <div className="border-b border-border-soft px-4 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary-300">
                      Library
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-text-primary">
                        {activeToolItem ? t(activeToolItem.labelKey) : null}
                      </h2>
                      <span className="text-xs text-text-tertiary">
                        {clips.length}
                      </span>
                    </div>
                  </div>
                  {activeTool === 'media' ? (
                    <div className="grid max-h-[560px] grid-cols-2 gap-2 overflow-y-auto p-3 lg:grid-cols-1">
                      {clips.map((clip) => (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => {
                            setSelectedClipId(clip.id)
                            setMobileMode('preview')
                          }}
                          className={`overflow-hidden rounded-[var(--r-input)] border text-left ${
                            selectedClip?.id === clip.id
                              ? 'border-primary-400 bg-primary-500/10'
                              : 'border-border-soft bg-surface-inset hover:border-border-primary'
                          }`}
                        >
                          <div
                            className={`aspect-video ${mediaWorkspaceClasses.mediaWell}`}
                          >
                            {clip.panel.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={clip.panel.imageUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="h-full" />
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 p-2.5">
                            <span className="font-mono text-[11px] text-text-secondary">
                              SHOT {String(clip.number).padStart(2, '0')}
                            </span>
                            <span
                              className={
                                clip.panel.videoUrl
                                  ? 'text-[10px] text-emerald-300'
                                  : 'text-[10px] text-amber-200'
                              }
                            >
                              {clip.panel.videoUrl ? t('video') : t('still')}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-sm leading-6 text-text-tertiary">
                      {t('unavailableTool')}
                    </div>
                  )}
                </aside>

                <section
                  className={`${mobileMode === 'preview' ? 'flex' : 'hidden lg:flex'} ${mediaWorkspaceClasses.stage} min-h-[420px] min-w-0 flex-col`}
                >
                  <div
                    className={`${mediaWorkspaceClasses.chrome} flex items-center justify-between border-b border-white/10 px-4 py-3`}
                  >
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary-300">
                        Main cut
                      </p>
                      <h2 className="mt-1 text-sm font-semibold text-white">
                        {t('preview')}
                      </h2>
                    </div>
                    <span className="font-mono text-xs text-white/55">
                      {selectedClip
                        ? `SHOT ${String(selectedClip.number).padStart(2, '0')}`
                        : '—'}
                    </span>
                  </div>
                  <div className="relative grid flex-1 place-items-center p-4">
                    {selectedClip?.panel.videoUrl ? (
                      <video
                        key={selectedClip.id}
                        src={selectedClip.panel.videoUrl}
                        controls
                        className="max-h-[520px] w-full object-contain"
                      />
                    ) : selectedClip?.panel.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedClip.panel.imageUrl}
                        alt={t('previewAlt')}
                        className="max-h-[520px] w-full object-contain"
                      />
                    ) : null}
                  </div>
                </section>

                <aside
                  className={`${mobileMode === 'adjust' ? 'block' : 'hidden lg:block'} min-w-0 border-l border-border-soft bg-surface-raised`}
                >
                  <div className="border-b border-border-soft px-4 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary-300">
                      Inspector
                    </p>
                    <h2 className="mt-1 text-sm font-semibold text-text-primary">
                      {t('mainCutSettings')}
                    </h2>
                  </div>
                  <dl className="divide-y divide-border-soft px-4">
                    {[
                      [t('ratio'), ratio],
                      [t('fps'), t('notSet')],
                      [
                        t('duration'),
                        targetDuration
                          ? t('durationValue', { duration: targetDuration })
                          : t('notSet'),
                      ],
                      [
                        t('availableVideos'),
                        t('clipCount', { count: videoClips.length }),
                      ],
                      [
                        t('stillFallbacks'),
                        t('clipCount', {
                          count: clips.length - videoClips.length,
                        }),
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-3 py-3 text-sm"
                      >
                        <dt className="text-text-tertiary">{label}</dt>
                        <dd className="text-right text-text-primary">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="m-4 rounded-[var(--r-input)] border border-border-soft bg-surface-inset p-3 text-xs leading-5 text-text-tertiary">
                    {t('timelineBoundary')}
                  </div>
                </aside>

                <section
                  className={`${mobileMode === 'timeline' ? 'block' : 'hidden lg:block'} ${mediaWorkspaceClasses.chrome} border-t border-border-soft lg:col-span-3 lg:col-start-2`}
                >
                  <div className="flex h-full min-h-[170px] flex-col">
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary-300">
                          Timeline
                        </span>
                        <span className="text-xs text-white/45">
                          {t('timelineViewOnly')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-white/35">
                        <button
                          type="button"
                          disabled
                          aria-label={t('undoUnavailable')}
                          className="grid h-11 w-11 place-items-center rounded-[var(--r-input)]"
                        >
                          <AppIcon name="undo" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled
                          aria-label={t('redoUnavailable')}
                          className="grid h-11 w-11 place-items-center rounded-[var(--r-input)]"
                        >
                          <AppIcon name="redo" className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-1 items-center gap-1 overflow-x-auto px-4 py-3">
                      <span className="mr-2 w-16 shrink-0 text-[11px] font-semibold text-white/50">
                        VIDEO 1
                      </span>
                      {clips.map((clip) => (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => {
                            setSelectedClipId(clip.id)
                            setMobileMode('preview')
                          }}
                          className={`relative h-20 w-32 shrink-0 overflow-hidden rounded-md border ${selectedClip?.id === clip.id ? 'border-primary-400' : 'border-white/10'}`}
                        >
                          {clip.panel.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={clip.panel.imageUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-white">
                            {String(clip.number).padStart(2, '0')}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )
        ) : null}

        {!hasBlockingSourceError ? (
          <nav
            aria-label={t('mobileAria')}
            className={`${mediaWorkspaceClasses.mobileDock} fixed inset-x-3 bottom-20 z-40 grid grid-cols-4 gap-1 rounded-2xl border p-2 backdrop-blur-xl lg:hidden`}
          >
            {(
              [
                ['preview', 'play', t('mobilePreview')],
                ['timeline', 'film', t('mobileTimeline')],
                ['media', 'folderOpen', t('mobileMedia')],
                ['adjust', 'sliders', t('mobileAdjust')],
              ] as const
            ).map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMobileMode(id)}
                aria-current={mobileMode === id ? 'page' : undefined}
                className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${mobileMode === id ? 'bg-primary-500/15 text-primary-200' : 'text-text-tertiary'}`}
              >
                <AppIcon name={icon} className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        ) : null}
      </main>
    </MediaWorkspaceSurface>
  )
}
