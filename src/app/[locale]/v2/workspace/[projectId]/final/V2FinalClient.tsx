'use client'

/**
 * Phase 12.7 — v2 FinalPage.
 *
 * Native HTML5 video player on the left (auto-picks the first panel
 * that has a videoUrl), 12-segment timeline strip below it, stats
 * panel + export CTAs on the right.
 *
 * Export model: KuiperAI does not stitch the final mp4. Instead we
 * package every panel video + storyboard image + dialogue script into
 * one zip; users finish the cut in CapCut/剪映. The legacy column
 * `episode.stitchedVideoUrl` now holds the zip key (semantic carry-over
 * to avoid a schema migration).
 */

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
  // URL-driven current episode (V2WorkspaceShell tab bar). Look up the
  // corresponding row from the project so stitchedVideoUrl / stitchStatus
  // and friends — which the hook intentionally doesn't expose — stay
  // available on this page.
  const { currentEpisodeId } = useCurrentEpisode(projectId)
  const buildHref = useEpisodePreservingHref()
  // Phase 12.5 — viewer-role users see disabled stitch buttons.
  const { canEdit } = useProjectAccess(projectId)
  const viewerTip = canEdit ? undefined : t('viewerHint')
  const episodes = project?.novelPromotionData?.episodes ?? []
  const currentEpisode = episodes.find((ep) => ep?.id === currentEpisodeId) ?? episodes[0] ?? null
  const storyboardsQuery = useStoryboards(projectId, currentEpisode?.id ?? null)
  const storyboardsData = storyboardsQuery.data as { storyboards?: StoryboardLike[] } | undefined
  const stitchMp4 = useStitchEpisodeMp4(projectId)

  const allPanels = useMemo<PanelLike[]>(() => {
    return (storyboardsData?.storyboards ?? []).flatMap((s) => s.panels ?? [])
  }, [storyboardsData])

  const panelsWithVideo = allPanels.filter((p) => p.videoUrl)
  const panelsWithImage = allPanels.filter((p) => p.imageUrl)
  const firstVideoPanel = panelsWithVideo[0] ?? null
  // Multi-shot B-path episodes have empty panel.videoUrl — the playable
  // mp4 lives at the group level. Count distinct multiShotGroupIds so
  // the package button still surfaces and the worker has something to
  // pack.
  const multiShotGroupCount = useMemo(() => {
    const ids = new Set<string>()
    for (const p of allPanels) {
      if (p.multiShotGroupId) ids.add(p.multiShotGroupId)
    }
    return ids.size
  }, [allPanels])
  const hasPackageableContent = panelsWithVideo.length > 0 || multiShotGroupCount > 0

  const [active, setActive] = useState<string | null>(null)
  const activePanel = active ? allPanels.find((p) => p.id === active) ?? firstVideoPanel : firstVideoPanel

  const ratio = project?.novelPromotionData?.videoRatio ?? '9:16'
  const targetDuration = project?.novelPromotionData?.targetDuration ?? 60
  const generatedSeconds = panelsWithVideo.length * 5 // rough estimate; Kling default 5s

  return (
    <div className="px-12 py-10">
      <div className="grid grid-cols-3 gap-8">
        {/* Player + Timeline */}
        <div className="col-span-2">
          <div className="relative overflow-hidden rounded-sm border border-amber-900/30 bg-stone-950">
            <div className="relative aspect-video bg-gradient-to-br from-stone-800 to-stone-900">
              {activePanel?.videoUrl ? (
                <video
                  key={activePanel.id}
                  src={activePanel.videoUrl}
                  controls
                  className="h-full w-full bg-stone-950"
                />
              ) : activePanel?.imageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activePanel.imageUrl}
                    alt="preview"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-stone-950/40">
                    <p className="font-fraunces text-base italic text-stone-300">{t('player.videoNotYet')}</p>
                  </div>
                </>
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <p className="font-fraunces text-base italic text-stone-500">{t('player.noStoryboard')}</p>
                </div>
              )}
            </div>
            <div className="absolute left-4 top-4 font-mono text-[14px] tracking-[0.3em] text-amber-300/80">
              {t('player.header')}
            </div>
          </div>

          {/* Timeline strip */}
          <div className="mt-5 rounded-sm border border-stone-800/60 bg-stone-900/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-fraunces text-sm italic text-amber-500/80">{t('timeline.title')}</div>
              <div className="font-mono text-[14px] tracking-wider text-stone-500">
                {t('timeline.ratio', { done: panelsWithVideo.length, total: allPanels.length })}
              </div>
            </div>
            <div className="flex h-12 gap-1 overflow-x-auto">
              {allPanels.map((p, i) => {
                const ready = Boolean(p.videoUrl)
                const isActive = activePanel?.id === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActive(p.id)}
                    className={`relative flex-shrink-0 overflow-hidden rounded-sm border-2 transition-all ${
                      isActive
                        ? 'border-amber-500'
                        : ready
                          ? 'border-amber-700/40'
                          : 'border-stone-800/60 opacity-50'
                    }`}
                    style={{ width: 48 }}
                    title={ready ? t('timeline.panelTitleReady') : p.imageUrl ? t('timeline.panelTitleImageOnly') : t('timeline.panelTitleNone')}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-stone-900" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-stone-950/40 to-transparent" />
                    <div className="absolute bottom-0.5 left-0.5 font-mono text-[8px] text-stone-200">
                      {String(i + 1).padStart(2, '0')}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Stats + Export */}
        <div className="col-span-1 space-y-5">
          <div className="rounded-sm border border-amber-900/20 bg-stone-900/40 p-5">
            <div className="mb-4 font-fraunces text-sm italic text-amber-500/80">{t('stats.title')}</div>
            <dl className="space-y-3">
              {[
                { k: t('stats.totalPanels'), v: t('stats.totalPanelsValue', { count: allPanels.length }) },
                { k: t('stats.withImage'), v: `${panelsWithImage.length}` },
                { k: t('stats.withVideo'), v: `${panelsWithVideo.length}` },
                { k: t('stats.resolution'), v: ratio },
                { k: t('stats.targetDuration'), v: t('stats.durationSeconds', { n: targetDuration }) },
                { k: t('stats.estimatedDuration'), v: t('stats.durationSeconds', { n: generatedSeconds }) },
              ].map((row) => (
                <div
                  key={row.k}
                  className="flex justify-between border-b border-stone-800/50 pb-2 last:border-0"
                >
                  <dt className="font-serif-cn text-sm text-stone-400">{row.k}</dt>
                  <dd className="self-end font-mono text-xs tracking-wider text-stone-200">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {currentEpisode?.stitchedVideoUrl ? (
            <div className="space-y-2">
              <a
                href={currentEpisode.stitchedVideoUrl}
                download={`episode-${currentEpisode.id}.zip`}
                className="flex w-full items-center justify-center gap-2 rounded-sm bg-amber-500 py-3 font-serif-cn text-base font-medium text-stone-950 transition-all hover:bg-amber-400"
              >
                <AppIcon name="download" className="h-4 w-4" />
                {t('package.downloadZip')}
              </a>
              <p className="rounded-sm border border-stone-800/60 bg-stone-900/40 px-3 py-2 font-serif-cn text-xs text-stone-400">
                {t('package.downloadHint')}
              </p>
              <button
                type="button"
                disabled={stitchMp4.isPending || !currentEpisodeId || !hasPackageableContent || !canEdit}
                onClick={() => currentEpisodeId && stitchMp4.mutate({ episodeId: currentEpisodeId })}
                title={viewerTip}
                className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-stone-800 bg-stone-900/40 py-2 font-mono text-[14px] tracking-wider text-stone-400 transition-all hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stitchMp4.isPending ? t('package.repackaging') : t('package.repackage')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={
                stitchMp4.isPending ||
                !currentEpisodeId ||
                !hasPackageableContent ||
                currentEpisode?.stitchStatus === 'rendering' ||
                !canEdit
              }
              onClick={() => currentEpisodeId && stitchMp4.mutate({ episodeId: currentEpisodeId })}
              title={
                !canEdit
                  ? viewerTip
                  : !hasPackageableContent
                  ? t('package.needContent')
                  : t('package.primaryHint')
              }
              className="flex w-full items-center justify-center gap-2 rounded-sm bg-amber-500 py-3 font-serif-cn text-base font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="download" className="h-4 w-4" />
              {stitchMp4.isPending
                ? t('package.packaging')
                : currentEpisode?.stitchStatus === 'rendering'
                  ? t('package.renderingInBg')
                  : (() => {
                      const parts: string[] = []
                      if (panelsWithVideo.length > 0) parts.push(t('package.summaryPanels', { count: panelsWithVideo.length }))
                      if (multiShotGroupCount > 0) parts.push(t('package.summaryMultiShot', { count: multiShotGroupCount }))
                      const summary = parts.length > 0 ? parts.join(' + ') : t('package.summaryEmpty')
                      return t('package.packageWithSummary', { summary })
                    })()}
            </button>
          )}
          {stitchMp4.isError ? (
            <p className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {(stitchMp4.error as Error)?.message ?? t('package.errorFallback')}
            </p>
          ) : null}

          <Link
            href={buildHref(`/${locale}/v2/workspace/${projectId}/script`)}
            className="flex items-center justify-center rounded-sm border border-stone-800 bg-stone-900/40 py-2.5 font-serif-cn text-xs text-stone-300 transition-all hover:border-amber-500/40 hover:text-amber-400"
          >
            {t('links.viewScript')}
          </Link>

          <div className="rounded-sm border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-rose-900/10 p-4">
            <div className="font-fraunces text-sm italic text-amber-400">{t('tagline.title')}</div>
            <div className="mt-2 font-serif-cn text-xs leading-relaxed text-stone-300">
              {t('tagline.body')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
