'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { useStoryboards } from '@/lib/query/hooks/useStoryboards'
import { useStitchEpisodeMp4 } from '@/lib/query/mutations/episode-stitch-mutations'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { useEpisodePreservingHref } from '../hooks/useEpisodePreservingHref'

interface V2FinalClientProps {
  projectId: string
  locale: string
}

interface PanelLike {
  id: string
  imageUrl?: string | null
  videoUrl?: string | null
  multiShotGroupId?: string | null
}

interface StoryboardLike {
  id: string
  panels?: PanelLike[]
}

interface EpisodeLike {
  id: string
  episodeNumber?: number | null
  title?: string | null
  stitchedVideoUrl?: string | null
  stitchStatus?: string | null
}

interface ProjectLike {
  novelPromotionData?: {
    videoRatio?: string | null
    targetDuration?: number | null
    episodes?: EpisodeLike[] | null
  } | null
}

export function V2FinalClient({ projectId, locale }: V2FinalClientProps) {
  const t = useTranslations('v2Final')
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLike | undefined
  const { currentEpisodeId } = useCurrentEpisode(projectId)
  const buildHref = useEpisodePreservingHref()
  const { canEdit } = useProjectAccess(projectId)
  const viewerTip = canEdit ? undefined : t('viewerHint')
  const episodes = project?.novelPromotionData?.episodes ?? []
  const currentEpisode = episodes.find((episode) => episode.id === currentEpisodeId) ?? episodes[0] ?? null
  const storyboardsQuery = useStoryboards(projectId, currentEpisode?.id ?? null)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined
  const stitchMp4 = useStitchEpisodeMp4(projectId)

  const allPanels = useMemo<PanelLike[]>(
    () => (storyboardsData?.storyboards ?? []).flatMap((storyboard) => storyboard.panels ?? []),
    [storyboardsData],
  )
  const panelsWithVideo = allPanels.filter((panel) => panel.videoUrl)
  const panelsWithImage = allPanels.filter((panel) => panel.imageUrl)
  const firstVideoPanel = panelsWithVideo[0] ?? allPanels[0] ?? null
  const multiShotGroupCount = useMemo(() => {
    const ids = new Set<string>()
    for (const panel of allPanels) {
      if (panel.multiShotGroupId) ids.add(panel.multiShotGroupId)
    }
    return ids.size
  }, [allPanels])
  const hasPackageableContent = panelsWithVideo.length > 0 || multiShotGroupCount > 0
  const [activeId, setActiveId] = useState<string | null>(null)
  const activePanel = allPanels.find((panel) => panel.id === activeId) ?? firstVideoPanel
  const ratio = project?.novelPromotionData?.videoRatio ?? '9:16'
  const targetDuration = project?.novelPromotionData?.targetDuration ?? 60
  const generatedSeconds = panelsWithVideo.length * 5
  const videoProgress = allPanels.length > 0 ? Math.round((panelsWithVideo.length / allPanels.length) * 100) : 0
  const isPackaging = stitchMp4.isPending || currentEpisode?.stitchStatus === 'rendering'
  const packageReady = Boolean(currentEpisode?.stitchedVideoUrl)
  const episodeLabel = currentEpisode?.title
    || (currentEpisode?.episodeNumber ? t('page.episodeNumber', { number: currentEpisode.episodeNumber }) : t('page.currentEpisode'))

  function startPackaging() {
    if (!currentEpisodeId) return
    stitchMp4.mutate({ episodeId: currentEpisodeId })
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-xs text-text-secondary">
            {episodeLabel}
          </span>
          <span className="rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 font-mono text-xs text-text-secondary">
            {ratio} · {targetDuration}s
          </span>
          <span className={`rounded-full border px-3 py-1.5 text-xs ${
            packageReady
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : isPackaging
                ? 'border-primary-500/30 bg-primary-500/10 text-primary-200'
                : 'border-border-soft bg-surface-raised text-text-tertiary'
          }`}>
            {packageReady ? t('status.packageReady') : isPackaging ? t('status.packaging') : t('status.draft')}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 space-y-4">
          <div className="kuiper-surface-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
              <div className="flex items-center gap-2">
                <AppIcon name="film" className="h-4 w-4 text-primary-300" />
                <h2 className="font-heading text-sm font-semibold text-text-primary">{t('player.title')}</h2>
              </div>
              <div className="font-mono text-[12px] text-text-tertiary">
                {activePanel ? t('player.shotLabel', { number: allPanels.findIndex((panel) => panel.id === activePanel.id) + 1 }) : '—'}
              </div>
            </div>
            <div className="relative aspect-video min-h-[240px] bg-black">
              {storyboardsQuery.isLoading ? (
                <div className="absolute inset-0 animate-pulse bg-surface-inset" />
              ) : activePanel?.videoUrl ? (
                <video key={activePanel.id} src={activePanel.videoUrl} controls className="h-full w-full bg-black object-contain" />
              ) : activePanel?.imageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={activePanel.imageUrl} alt={t('player.previewAlt')} className="h-full w-full object-contain" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45 p-6 text-center">
                    <div className="rounded-[var(--r-card)] border border-white/10 bg-black/70 px-5 py-4 backdrop-blur-sm">
                      <AppIcon name="video" className="mx-auto h-5 w-5 text-text-tertiary" />
                      <p className="mt-2 text-sm text-text-secondary">{t('player.videoNotYet')}</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                  <div>
                    <AppIcon name="clapperboard" className="mx-auto h-8 w-8 text-text-tertiary" />
                    <p className="mt-3 text-sm text-text-secondary">{t('player.noStoryboard')}</p>
                    <Link
                      href={buildHref(`/${locale}/v2/workspace/${projectId}/storyboard`)}
                      className="kuiper-secondary-button mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm"
                    >
                      {t('links.openStoryboard')}
                      <AppIcon name="arrowRight" className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="kuiper-surface-card p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-heading text-sm font-semibold text-text-primary">{t('timeline.title')}</h2>
                <p className="mt-1 text-xs text-text-tertiary">
                  {t('timeline.ratio', { done: panelsWithVideo.length, total: allPanels.length })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-inset">
                  <div className="h-full rounded-full bg-primary-500 transition-[width]" style={{ width: `${videoProgress}%` }} />
                </div>
                <span className="w-9 text-right font-mono text-[12px] text-text-secondary">{videoProgress}%</span>
              </div>
            </div>
            {allPanels.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {allPanels.map((panel, index) => {
                  const ready = Boolean(panel.videoUrl)
                  const active = activePanel?.id === panel.id
                  return (
                    <button
                      key={panel.id}
                      type="button"
                      onClick={() => setActiveId(panel.id)}
                      title={ready ? t('timeline.panelTitleReady') : panel.imageUrl ? t('timeline.panelTitleImageOnly') : t('timeline.panelTitleNone')}
                      className={`group relative h-[72px] w-[112px] shrink-0 overflow-hidden rounded-[var(--r-input)] border transition-colors ${
                        active
                          ? 'border-primary-400 ring-1 ring-primary-500/40'
                          : 'border-border-soft hover:border-border-primary'
                      }`}
                    >
                      {panel.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={panel.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-surface-inset" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                      <span className="absolute bottom-1.5 left-2 font-mono text-[11px] text-white/90">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-black/50 ${ready ? 'bg-emerald-400' : 'bg-text-tertiary'}`} />
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-[var(--r-card)] border border-dashed border-border-soft py-8 text-center text-sm text-text-tertiary">
                {t('timeline.empty')}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:h-fit">
          <section className="kuiper-surface-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-heading text-sm font-semibold text-text-primary">{t('progress.title')}</h2>
              <span className="font-mono text-sm text-primary-300">{videoProgress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-inset">
              <div className="h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-300 transition-[width]" style={{ width: `${videoProgress}%` }} />
            </div>
            <dl className="mt-4 divide-y divide-border-soft border-y border-border-soft">
              {[
                { label: t('stats.totalPanels'), value: t('stats.totalPanelsValue', { count: allPanels.length }) },
                { label: t('stats.withImage'), value: `${panelsWithImage.length}` },
                { label: t('stats.withVideo'), value: `${panelsWithVideo.length}` },
                { label: t('stats.targetDuration'), value: t('stats.durationSeconds', { n: targetDuration }) },
                { label: t('stats.estimatedDuration'), value: t('stats.durationSeconds', { n: generatedSeconds }) },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between py-2.5 text-sm">
                  <dt className="text-text-tertiary">{row.label}</dt>
                  <dd className="font-mono text-[13px] text-text-primary">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="kuiper-surface-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <AppIcon name="package" className="h-4 w-4 text-primary-300" />
              <h2 className="font-heading text-sm font-semibold text-text-primary">{t('package.title')}</h2>
            </div>
            <p className="text-sm leading-6 text-text-secondary">{t('package.description')}</p>

            {packageReady && currentEpisode?.stitchedVideoUrl ? (
              <a
                href={currentEpisode.stitchedVideoUrl}
                download={`episode-${currentEpisode.id}.zip`}
                className="kuiper-primary-button mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--r-input)] px-4 py-3 text-sm font-semibold"
              >
                <AppIcon name="download" className="h-4 w-4" />
                {t('package.downloadZip')}
              </a>
            ) : (
              <button
                type="button"
                disabled={isPackaging || !currentEpisodeId || !hasPackageableContent || !canEdit}
                onClick={startPackaging}
                title={!canEdit ? viewerTip : !hasPackageableContent ? t('package.needContent') : t('package.primaryHint')}
                className="kuiper-primary-button mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--r-input)] px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AppIcon name={isPackaging ? 'loader' : 'package'} className={`h-4 w-4 ${isPackaging ? 'animate-spin' : ''}`} />
                {isPackaging ? t('package.packaging') : t('package.create')}
              </button>
            )}

            {packageReady ? (
              <button
                type="button"
                disabled={stitchMp4.isPending || !currentEpisodeId || !hasPackageableContent || !canEdit}
                onClick={startPackaging}
                title={viewerTip}
                className="kuiper-secondary-button mt-2 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AppIcon name="refresh" className={`h-4 w-4 ${stitchMp4.isPending ? 'animate-spin' : ''}`} />
                {stitchMp4.isPending ? t('package.repackaging') : t('package.repackage')}
              </button>
            ) : null}

            <div className="mt-3 rounded-[var(--r-input)] border border-border-soft bg-surface-inset p-3 text-xs leading-5 text-text-tertiary">
              {t('package.downloadHint')}
            </div>
            {stitchMp4.isError ? (
              <div role="alert" className="mt-3 rounded-[var(--r-input)] border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                {(stitchMp4.error as Error)?.message ?? t('package.errorFallback')}
              </div>
            ) : null}
          </section>

          <nav aria-label={t('links.related')} className="grid grid-cols-2 gap-2">
            <Link href={buildHref(`/${locale}/v2/workspace/${projectId}/storyboard`)} className="kuiper-secondary-button flex items-center justify-center gap-2 px-3 py-2.5 text-sm">
              <AppIcon name="clapperboard" className="h-4 w-4" />
              {t('links.viewStoryboard')}
            </Link>
            <Link href={buildHref(`/${locale}/v2/workspace/${projectId}/script`)} className="kuiper-secondary-button flex items-center justify-center gap-2 px-3 py-2.5 text-sm">
              <AppIcon name="fileText" className="h-4 w-4" />
              {t('links.viewScript')}
            </Link>
          </nav>
        </aside>
      </div>
    </main>
  )
}
