'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { PageHeader } from '@/components/v2/PageHeader'
import { StatusPill } from '@/components/v2/StatusPill'
import {
  MediaWorkspaceSurface,
  mediaWorkspaceClasses,
} from '@/components/v2/MediaWorkspaceSurface'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import {
  useStoryboards,
  type StoryboardPanel,
} from '@/lib/query/hooks/useStoryboards'
import {
  resolveSafeDeliveryDownloadUrl,
  type ReadyEpisodeDeliveryV1,
  useEpisodeDelivery,
} from '@/lib/query/hooks/useEpisodeDelivery'
import { useGenerationJobs } from '@/lib/query/hooks/useGenerationJobs'
import { useStitchEpisodeMp4 } from '@/lib/query/mutations/episode-stitch-mutations'
import { useCancelGenerationJob } from '@/lib/query/mutations/task-mutations'
import type { JobView } from '@/lib/task/job-view'
import { TASK_TYPE } from '@/lib/task/types'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { useEpisodePreservingHref } from '../hooks/useEpisodePreservingHref'

interface V2FinalClientProps {
  projectId: string
  locale: string
}

type SupportedRatio = '9:16' | '1:1' | '16:9'

function readSupportedRatio(value: string | null | undefined): SupportedRatio | null {
  return value === '9:16' || value === '1:1' || value === '16:9'
    ? value
    : null
}

function previewAspectClass(ratio: SupportedRatio | null): string {
  if (ratio === '9:16') return 'aspect-[9/16] w-full max-w-[420px]'
  if (ratio === '1:1') return 'aspect-square w-full max-w-[680px]'
  if (ratio === '16:9') return 'aspect-video w-full'
  return 'min-h-[320px] w-full'
}

function panelVideoUrl(panel: StoryboardPanel): string | null {
  return panel.lipSyncVideoUrl != null
    ? panel.lipSyncVideoUrl
    : panel.videoUrl ?? null
}

function deliveryJobCreatedAt(job: JobView): number {
  const createdAt = Date.parse(job.createdAt)
  if (Number.isFinite(createdAt)) return createdAt
  const updatedAt = Date.parse(job.updatedAt)
  return Number.isFinite(updatedAt) ? updatedAt : 0
}

function selectLatestDeliveryJob(
  jobs: JobView[],
  projectId: string,
  episodeId: string | null,
): JobView | null {
  if (!episodeId) return null
  return jobs
    .filter(
      (job) =>
        job.type === TASK_TYPE.EPISODE_STITCH_MP4 &&
        job.projectId === projectId &&
        job.episodeId === episodeId &&
        job.targetType === 'NovelPromotionEpisode' &&
        job.targetId === episodeId,
    )
    .reduce<JobView | null>((latest, job) => {
      if (!latest) return job
      const latestTime = deliveryJobCreatedAt(latest)
      const jobTime = deliveryJobCreatedAt(job)
      if (jobTime !== latestTime) return jobTime > latestTime ? job : latest
      return job.id.localeCompare(latest.id) > 0 ? job : latest
    }, null)
}

function normalizedProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.min(100, Math.max(0, Math.round(progress)))
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function formatDeliveryCreatedAt(value: string, locale: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  const displayLocale = locale.toLowerCase().startsWith('zh') ? 'zh-TW' : locale
  try {
    return new Intl.DateTimeFormat(displayLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return value
  }
}

export function V2FinalClient({ projectId, locale }: V2FinalClientProps) {
  const t = useTranslations('v2Final')
  const projectQuery = useProjectData(projectId)
  const access = useProjectAccess(projectId)
  const { currentEpisodeId, currentEpisode } = useCurrentEpisode(projectId)
  const storyboardsQuery = useStoryboards(projectId, currentEpisodeId)
  const deliveryQuery = useEpisodeDelivery(projectId, currentEpisodeId)
  const refetchDelivery = deliveryQuery.refetch
  const deliveryJobsQuery = useGenerationJobs({
    projectId,
    episodeId: currentEpisodeId,
    types: [TASK_TYPE.EPISODE_STITCH_MP4],
    limit: 10,
    enabled: Boolean(currentEpisodeId && access.allowed),
  })
  const packageMutation = useStitchEpisodeMp4(projectId)
  const cancelPackageMutation = useCancelGenerationJob(
    projectId,
    t('job.cancelErrorFallback'),
  )
  const buildHref = useEpisodePreservingHref()
  const [activeId, setActiveId] = useState<string | null>(null)

  const project = projectQuery.data
  const ratioValue = project?.novelPromotionData?.videoRatio
  const ratio = readSupportedRatio(ratioValue)
  const targetDuration = project?.novelPromotionData?.targetDuration
  const allPanels = useMemo<StoryboardPanel[]>(
    () =>
      (storyboardsQuery.data?.storyboards ?? []).flatMap(
        (storyboard) => storyboard.panels,
      ),
    [storyboardsQuery.data?.storyboards],
  )
  const panelsWithVideo = allPanels.filter((panel) => panelVideoUrl(panel))
  const defaultPanel = panelsWithVideo[0] ?? allPanels[0] ?? null
  const activePanel =
    allPanels.find((panel) => panel.id === activeId) ?? defaultPanel
  const videoProgress =
    allPanels.length > 0
      ? Math.round((panelsWithVideo.length / allPanels.length) * 100)
      : 0

  const deliveryJobs = useMemo(
    () => deliveryJobsQuery.data?.pages.flatMap((page) => page.tasks) ?? [],
    [deliveryJobsQuery.data?.pages],
  )
  const latestDeliveryJob = useMemo(
    () => selectLatestDeliveryJob(deliveryJobs, projectId, currentEpisodeId),
    [currentEpisodeId, deliveryJobs, projectId],
  )
  const activeDeliveryJob =
    latestDeliveryJob?.status === 'queued' ||
    latestDeliveryJob?.status === 'running'
      ? latestDeliveryJob
      : null
  const transportRecoveredJobId = useRef<string | null>(null)

  useEffect(() => {
    if (packageMutation.isError && activeDeliveryJob) {
      transportRecoveredJobId.current = activeDeliveryJob.id
    }
  }, [activeDeliveryJob, packageMutation.isError])

  const unresolvedPackageTransportError = Boolean(
    packageMutation.isError &&
      transportRecoveredJobId.current !== latestDeliveryJob?.id,
  )
  const latestDeliveryFailed = latestDeliveryJob?.status === 'failed'
  const latestDeliveryCancelled = latestDeliveryJob?.status === 'cancelled'
  const completedDeliveryJobKey =
    latestDeliveryJob?.status === 'completed'
      ? `${latestDeliveryJob.id}:${latestDeliveryJob.updatedAt}`
      : null
  const lastRefetchedCompletedJob = useRef<string | null>(null)
  const [confirmedDeliveryJobKey, setConfirmedDeliveryJobKey] = useState<
    string | null
  >(null)
  const [confirmingDeliveryJobKey, setConfirmingDeliveryJobKey] = useState<
    string | null
  >(null)
  const [confirmedDeliveryReceipt, setConfirmedDeliveryReceipt] = useState<{
    jobKey: string
    delivery: ReadyEpisodeDeliveryV1
  } | null>(null)

  const confirmCompletedDelivery = useCallback(
    async (jobKey: string, taskId: string) => {
      setConfirmingDeliveryJobKey(jobKey)
      try {
        const result = await refetchDelivery()
        const refreshedDelivery =
          result?.isSuccess === true
            ? result.data?.delivery
            : null
        const refreshedSafeUrl =
          refreshedDelivery?.status === 'ready' &&
          refreshedDelivery.version === 'v1' &&
          refreshedDelivery.taskId === taskId &&
          refreshedDelivery.stale === false
            ? resolveSafeDeliveryDownloadUrl(refreshedDelivery.downloadUrl)
            : null
        if (refreshedSafeUrl && refreshedDelivery?.version === 'v1') {
          setConfirmedDeliveryJobKey(jobKey)
          setConfirmedDeliveryReceipt({
            jobKey,
            delivery: refreshedDelivery,
          })
        } else {
          setConfirmedDeliveryJobKey((current) =>
            current === jobKey ? null : current,
          )
          setConfirmedDeliveryReceipt((current) =>
            current?.jobKey === jobKey ? null : current,
          )
        }
      } catch {
        setConfirmedDeliveryJobKey((current) =>
          current === jobKey ? null : current,
        )
        setConfirmedDeliveryReceipt((current) =>
          current?.jobKey === jobKey ? null : current,
        )
      } finally {
        setConfirmingDeliveryJobKey((current) =>
          current === jobKey ? null : current,
        )
      }
    },
    [refetchDelivery],
  )

  useEffect(() => {
    if (!completedDeliveryJobKey || latestDeliveryJob?.status !== 'completed') {
      setConfirmedDeliveryJobKey(null)
      setConfirmedDeliveryReceipt(null)
      return
    }
    if (lastRefetchedCompletedJob.current === completedDeliveryJobKey) return
    lastRefetchedCompletedJob.current = completedDeliveryJobKey
    setConfirmedDeliveryJobKey((current) =>
      current === completedDeliveryJobKey ? current : null,
    )
    setConfirmedDeliveryReceipt((current) =>
      current?.jobKey === completedDeliveryJobKey ? current : null,
    )
    void confirmCompletedDelivery(completedDeliveryJobKey, latestDeliveryJob.id)
  }, [completedDeliveryJobKey, confirmCompletedDelivery, latestDeliveryJob])

  const deliveryInput = deliveryQuery.data?.input ?? null
  const queriedDelivery = deliveryQuery.data?.delivery ?? null
  const queriedDeliveryMatchesCompletedJob = Boolean(
    queriedDelivery?.version === 'v1' &&
      queriedDelivery.taskId === latestDeliveryJob?.id,
  )
  const delivery =
    queriedDeliveryMatchesCompletedJob
      ? queriedDelivery
      : completedDeliveryJobKey &&
    confirmedDeliveryReceipt?.jobKey === completedDeliveryJobKey
        ? confirmedDeliveryReceipt.delivery
        : queriedDelivery
  const safeDownloadUrl =
    delivery?.status === 'ready'
      ? resolveSafeDeliveryDownloadUrl(delivery.downloadUrl)
      : null
  const invalidReadyDelivery = delivery?.status === 'ready' && !safeDownloadUrl
  const isStaleDelivery = delivery?.version === 'v1' && delivery.stale
  const isLegacyDelivery = delivery?.version === 'legacy'
  const completedDeliveryCurrent = Boolean(
    completedDeliveryJobKey &&
      confirmedDeliveryJobKey === completedDeliveryJobKey &&
      delivery?.version === 'v1' &&
      delivery.taskId === latestDeliveryJob?.id &&
      delivery.stale === false &&
      safeDownloadUrl,
  )
  const completedDeliveryAwaitingConfirmation = Boolean(
    latestDeliveryJob?.status === 'completed' &&
      !completedDeliveryCurrent &&
      !isStaleDelivery,
  )
  const isConfirmingCompletedDelivery = Boolean(
    completedDeliveryJobKey &&
      confirmingDeliveryJobKey === completedDeliveryJobKey,
  )
  const isRequestingPackage = Boolean(activeDeliveryJob) || packageMutation.isPending
  const priorDeliveryOnly = Boolean(
    safeDownloadUrl &&
      (activeDeliveryJob ||
        packageMutation.isPending ||
        unresolvedPackageTransportError ||
        latestDeliveryFailed ||
        latestDeliveryCancelled ||
        completedDeliveryAwaitingConfirmation ||
        isStaleDelivery),
  )
  const deliveryJobsUnavailable = Boolean(
    deliveryJobsQuery.isError ||
      (deliveryJobsQuery.isLoading && !deliveryJobsQuery.data) ||
      (deliveryJobsQuery.isFetching && !activeDeliveryJob),
  )
  const canRequestPackage = Boolean(
    access.canEdit &&
      currentEpisodeId &&
      deliveryInput?.canCreate === true &&
      !isRequestingPackage &&
      !deliveryJobsUnavailable,
  )
  const requestDisabledReason = !access.canEdit
    ? t('access.viewerReason')
    : deliveryInput?.canCreate !== true
      ? t('package.serverCannotCreate')
      : deliveryJobsUnavailable
        ? t('job.unavailableReason')
        : null
  const cancelDisabledReason = !activeDeliveryJob
    ? null
    : !access.canEdit
      ? t('access.viewerCancelReason')
      : !activeDeliveryJob.canCancel
        ? t('job.cannotCancelReason')
        : cancelPackageMutation.isPending
          ? t('job.cancelPending')
          : null

  const sourceErrors: string[] = []
  if (projectQuery.isError) {
    sourceErrors.push(
      t('states.projectError', {
        message: errorMessage(projectQuery.error, t('states.unknownError')),
      }),
    )
  }
  if (storyboardsQuery.isError) {
    sourceErrors.push(
      t('states.storyboardError', {
        message: errorMessage(storyboardsQuery.error, t('states.unknownError')),
      }),
    )
  }
  if (access.isError) {
    sourceErrors.push(
      t('states.accessError', {
        message: errorMessage(access.error, t('states.unknownError')),
      }),
    )
  } else if (!access.isLoading && !access.allowed) {
    sourceErrors.push(t('states.accessDenied'))
  }

  const initialLoading =
    projectQuery.isLoading ||
    access.isLoading ||
    Boolean(
      currentEpisodeId && storyboardsQuery.isLoading && !storyboardsQuery.data,
    )
  const blockingSourceError =
    (projectQuery.isError && !projectQuery.data) ||
    (storyboardsQuery.isError && !storyboardsQuery.data) ||
    (access.isError && !access.allowed) ||
    (!access.isLoading && !access.isError && !access.allowed)
  const staleSourceData = sourceErrors.length > 0 && !blockingSourceError

  const clipComposerHref = buildHref(
    `/${locale}/v2/workspace/${projectId}/clip-composer`,
  )
  const storyboardHref = buildHref(
    `/${locale}/v2/workspace/${projectId}/storyboard`,
  )

  function retrySources() {
    if (projectQuery.isError) void projectQuery.refetch()
    if (storyboardsQuery.isError) void storyboardsQuery.refetch()
    if (access.isError || !access.allowed) void access.refetch()
  }

  function requestPackage() {
    if (
      !access.canEdit ||
      !currentEpisodeId ||
      deliveryInput?.canCreate !== true ||
      isRequestingPackage ||
      deliveryJobsUnavailable
    ) {
      return
    }
    packageMutation.mutate(
      { episodeId: currentEpisodeId },
      {
        onSettled: () => {
          void Promise.all([
            deliveryQuery.refetch(),
            deliveryJobsQuery.refetch(),
          ])
        },
      },
    )
  }

  function cancelActivePackage() {
    if (
      !access.canEdit ||
      !activeDeliveryJob ||
      !activeDeliveryJob.canCancel ||
      cancelPackageMutation.isPending
    ) {
      return
    }
    cancelPackageMutation.mutate(activeDeliveryJob.id, {
      onSettled: () => {
        void deliveryJobsQuery.refetch()
      },
    })
  }

  if (initialLoading) {
    return (
      <MediaWorkspaceSurface>
        <main
          aria-busy="true"
          aria-label={t('states.loading')}
          className="kuiper-workspace-page mx-auto w-full max-w-[1800px] space-y-4 px-[var(--workspace-gutter)] py-6 sm:py-8"
        >
          <p className="sr-only">{t('states.loading')}</p>
          <div className="h-28 animate-pulse rounded-[var(--r-card)] bg-overlay" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="h-[520px] animate-pulse rounded-[var(--r-card)] bg-overlay" />
            <div className="h-[420px] animate-pulse rounded-[var(--r-card)] bg-overlay" />
          </div>
        </main>
      </MediaWorkspaceSurface>
    )
  }

  if (blockingSourceError) {
    return (
      <MediaWorkspaceSurface>
        <main className="kuiper-workspace-page mx-auto w-full max-w-3xl px-[var(--workspace-gutter)] py-8">
          <section
            role="alert"
            className="rounded-[var(--r-card)] border border-rose-500/30 bg-rose-500/10 p-6"
          >
            <h1 className="font-heading text-xl font-semibold text-rose-100">
              {t('states.loadErrorTitle')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-rose-200/80">
              {t('states.loadErrorBlocking')}
            </p>
            <ul className="mt-4 space-y-1 text-sm text-rose-100/80">
              {sourceErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={retrySources}
              className="kuiper-secondary-button mt-5 min-h-11 px-4 text-sm"
            >
              {t('states.retry')}
            </button>
          </section>
        </main>
      </MediaWorkspaceSurface>
    )
  }

  const ratioLabel = ratioValue || t('states.notSet')
  const durationLabel =
    typeof targetDuration === 'number'
      ? t('stats.durationSeconds', { n: targetDuration })
      : t('states.notSet')
  const deliveryStatus = activeDeliveryJob
    ? activeDeliveryJob.status === 'queued'
      ? t('status.queued')
      : t('status.running')
    : packageMutation.isPending
      ? t('status.requesting')
      : unresolvedPackageTransportError || latestDeliveryFailed
        ? t('status.latestFailed')
        : latestDeliveryCancelled
          ? t('status.latestCancelled')
          : isStaleDelivery
            ? t('status.stale')
            : isLegacyDelivery
              ? t('status.legacy')
          : completedDeliveryAwaitingConfirmation
            ? t('status.syncing')
            : completedDeliveryCurrent || safeDownloadUrl
              ? t('status.packageReady')
              : t('status.notCreated')
  const deliveryStatusTone = activeDeliveryJob ||
    packageMutation.isPending ||
    completedDeliveryAwaitingConfirmation
    ? 'active'
    : unresolvedPackageTransportError || latestDeliveryFailed
      ? 'danger'
      : latestDeliveryCancelled
        ? 'warning'
        : isStaleDelivery || isLegacyDelivery
          ? 'warning'
        : safeDownloadUrl
          ? 'success'
          : 'neutral'

  return (
    <MediaWorkspaceSurface>
      <main className="kuiper-workspace-page mx-auto min-w-0 w-full max-w-[1800px] px-[var(--workspace-gutter)] py-6 sm:py-8">
        <PageHeader
          tone="dark"
          className="border-b border-border-soft pb-5"
          eyebrow={t('page.eyebrow')}
          title={t('page.title')}
          description={t('page.subtitle')}
          context={
            <span>
              {currentEpisode?.name ?? t('page.noEpisodeContext')}
            </span>
          }
          actions={
            <div role="status" aria-live="polite" className="flex flex-wrap gap-2">
              <StatusPill
                label={ratioLabel}
                detail={durationLabel}
                tone="info"
              />
              <StatusPill
                label={deliveryStatus}
                tone={deliveryStatusTone}
              />
            </div>
          }
        />

        {staleSourceData ? (
          <section
            role="alert"
            className="mt-4 rounded-[var(--r-card)] border border-[var(--editorial-500)]/30 bg-[var(--editorial-500)]/10 p-4"
          >
            <p className="text-sm text-[var(--editorial-400)]">{t('states.loadErrorStale')}</p>
            <ul className="mt-2 space-y-1 text-xs text-text-secondary">
              {sourceErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={retrySources}
              className="kuiper-secondary-button mt-3 min-h-11 px-4 text-sm"
            >
              {t('states.retry')}
            </button>
          </section>
        ) : null}

        {!currentEpisodeId ? (
          <section className="mt-5 rounded-[var(--r-card)] border border-dashed border-border-soft bg-surface-raised p-8 text-center">
            <AppIcon name="fileText" className="mx-auto h-8 w-8 text-text-tertiary" />
            <h2 className="mt-3 text-lg font-semibold text-text-primary">
              {t('states.noEpisodeTitle')}
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-text-secondary">
              {t('states.noEpisodeDescription')}
            </p>
          </section>
        ) : (
          <>
            <nav
              aria-label={t('workspace.navigation')}
              className={`${mediaWorkspaceClasses.chrome} sticky top-0 z-20 -mx-[var(--workspace-gutter)] mb-5 mt-4 flex gap-1 overflow-x-auto border-b border-border-soft px-[var(--workspace-gutter)] py-2 backdrop-blur-xl`}
            >
              {[
                ['#delivery-preview', t('workspace.review'), 'play'],
                [clipComposerHref, t('workspace.composer'), 'sliders'],
                ['#asset-delivery', t('workspace.deliver'), 'package'],
              ].map(([href, label, icon]) => (
                <Link
                  key={href}
                  href={href}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--r-input)] px-3 text-sm font-semibold transition-colors ${href === '#asset-delivery' ? mediaWorkspaceClasses.deliverCue : 'text-text-secondary hover:bg-overlay hover:text-text-primary'}`}
                >
                  <AppIcon name={icon as 'play' | 'sliders' | 'package'} className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </nav>

            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <section className="min-w-0 space-y-4">
                {allPanels.length === 0 ? (
                  <section
                    id="delivery-preview"
                    aria-label={t('player.title')}
                    className="scroll-mt-24 rounded-[var(--r-card)] border border-dashed border-border-soft bg-surface-raised p-8 text-center"
                  >
                    <AppIcon
                      name="clapperboard"
                      className="mx-auto h-8 w-8 text-text-tertiary"
                    />
                    <h2 className="mt-3 text-lg font-semibold text-text-primary">
                      {t('states.emptyTitle')}
                    </h2>
                    <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-text-secondary">
                      {t('states.emptyDescription')}
                    </p>
                    <Link
                      href={storyboardHref}
                      className="kuiper-primary-button mt-5 inline-flex min-h-11 items-center gap-2 px-5 text-sm font-semibold"
                    >
                      {t('links.openStoryboard')}
                      <AppIcon name="arrowRight" className="h-4 w-4" />
                    </Link>
                  </section>
                ) : (
                  <>
                    <section
                      id="delivery-preview"
                      aria-label={t('player.title')}
                      className="kuiper-surface-card scroll-mt-24 overflow-hidden"
                    >
                  <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
                    <div className="flex items-center gap-2">
                      <AppIcon name="film" className="h-4 w-4 text-primary-300" />
                      <h2 className="font-heading text-sm font-semibold text-text-primary">
                        {t('player.title')}
                      </h2>
                    </div>
                    <span className="font-mono text-[12px] text-text-tertiary">
                      {activePanel
                        ? t('player.shotLabel', {
                            number: allPanels.findIndex((panel) => panel.id === activePanel.id) + 1,
                          })
                        : '—'}
                    </span>
                  </div>
                  <div className={`grid min-h-[320px] place-items-center p-3 sm:p-4 ${mediaWorkspaceClasses.stage}`}>
                    <div
                      data-aspect-ratio={ratio ?? 'unknown'}
                      className={`relative overflow-hidden ${previewAspectClass(ratio)}`}
                    >
                      {activePanel && panelVideoUrl(activePanel) ? (
                        <video
                          key={activePanel.id}
                          src={panelVideoUrl(activePanel) ?? undefined}
                          controls
                          className="h-full w-full object-contain"
                        />
                      ) : activePanel?.imageUrl ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={activePanel.imageUrl}
                            alt={t('player.previewAlt')}
                            className="h-full w-full object-contain"
                          />
                          <div className="absolute inset-0 grid place-items-center bg-black/45 p-5 text-center">
                            <p className="rounded-[var(--r-input)] border border-white/10 bg-black/70 px-4 py-3 text-sm text-text-secondary">
                              {t('player.videoNotYet')}
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="grid h-full min-h-[280px] place-items-center text-sm text-text-tertiary">
                          {t('player.noMedia')}
                        </div>
                      )}
                    </div>
                  </div>
                    </section>

                    <section className="kuiper-surface-card p-4" aria-label={t('timeline.title')}>
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="font-heading text-sm font-semibold text-text-primary">
                        {t('timeline.title')}
                      </h2>
                      <p className="mt-1 text-xs text-text-tertiary">
                        {t('timeline.ratio', { done: panelsWithVideo.length, total: allPanels.length })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        role="progressbar"
                        aria-label={t('progress.aria')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={videoProgress}
                        className="h-2 w-32 overflow-hidden rounded-full bg-surface-inset"
                      >
                        <div
                          className="h-full rounded-full bg-primary-500 transition-[width]"
                          style={{ width: `${videoProgress}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-mono text-[12px] text-text-secondary">
                        {videoProgress}%
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {allPanels.map((panel, index) => {
                      const ready = Boolean(panelVideoUrl(panel))
                      const active = activePanel?.id === panel.id
                      const ariaLabel = ready
                        ? t('timeline.panelAriaReady', { number: index + 1 })
                        : panel.imageUrl
                          ? t('timeline.panelAriaImage', { number: index + 1 })
                          : t('timeline.panelAriaEmpty', { number: index + 1 })
                      return (
                        <button
                          key={panel.id}
                          type="button"
                          onClick={() => setActiveId(panel.id)}
                          aria-label={ariaLabel}
                          aria-pressed={active}
                          className={`group relative h-[76px] w-[116px] shrink-0 overflow-hidden rounded-[var(--r-input)] border transition-colors ${active ? 'border-primary-400 ring-1 ring-primary-500/40' : 'border-border-soft hover:border-border-primary'}`}
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
                    </section>
                  </>
                )}
              </section>

              <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:h-fit">
                <section className="kuiper-surface-card p-4">
                  <h2 className="font-heading text-sm font-semibold text-text-primary">
                    {t('progress.title')}
                  </h2>
                  <dl
                    aria-label={t('progress.receiptAria')}
                    className="mt-4 divide-y divide-border-soft border-y border-border-soft"
                  >
                    {(deliveryInput
                      ? [
                          [
                            t('stats.selectedVideo'),
                            t('stats.selectedVideoValue', {
                              count: deliveryInput.selectedVideoCount,
                            }),
                          ],
                          [
                            t('stats.image'),
                            t('stats.imageValue', {
                              count: deliveryInput.imageCount,
                            }),
                          ],
                          [
                            t('stats.multiShotVideo'),
                            t('stats.multiShotVideoValue', {
                              count: deliveryInput.multiShotVideoCount,
                            }),
                          ],
                          [
                            t('stats.voiceAudio'),
                            t('stats.voiceAudioValue', {
                              count: deliveryInput.voiceAudioCount,
                            }),
                          ],
                          [
                            t('stats.missingVoiceAudio'),
                            t('stats.missingVoiceAudioValue', {
                              count: deliveryInput.missingVoiceAudioCount,
                            }),
                          ],
                        ]
                      : [[t('stats.serverReceipt'), t('states.unavailable')]]
                    ).map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <dt className="text-text-tertiary">{label}</dt>
                        <dd className="text-right text-[13px] text-text-primary">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section
                  id="asset-delivery"
                  aria-label={t('package.title')}
                  aria-busy={
                    deliveryQuery.isLoading ||
                    deliveryQuery.isFetching ||
                    isConfirmingCompletedDelivery ||
                    isRequestingPackage
                  }
                  className={`kuiper-surface-card scroll-mt-24 p-4 ${mediaWorkspaceClasses.deliveryPanel}`}
                >
                  <div className="mb-4 flex items-center gap-2">
                    <AppIcon name="package" className={`h-4 w-4 ${mediaWorkspaceClasses.deliverCue}`} />
                    <h2 className="font-heading text-sm font-semibold text-text-primary">
                      {t('package.title')}
                    </h2>
                  </div>
                  <p className="text-sm leading-6 text-text-secondary">
                    {t('package.description')}
                  </p>
                  <p className="mt-3 rounded-[var(--r-input)] border border-primary-400/20 bg-primary-500/5 p-3 text-xs leading-5 text-text-secondary">
                    {t('package.boundary')}
                  </p>

                  {deliveryJobsQuery.isLoading && !deliveryJobsQuery.data ? (
                    <p
                      role="status"
                      aria-live="polite"
                      className="mt-4 rounded-[var(--r-input)] border border-border-soft bg-surface-inset p-3 text-xs text-text-secondary"
                    >
                      {t('job.checking')}
                    </p>
                  ) : deliveryJobsQuery.isError && !deliveryJobsQuery.data ? (
                    <div
                      role="alert"
                      className="mt-4 rounded-[var(--r-input)] border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100"
                    >
                      <p>{t('job.statusError')}</p>
                      <button
                        type="button"
                        onClick={() => void deliveryJobsQuery.refetch()}
                        className="kuiper-secondary-button mt-3 min-h-11 px-3 text-sm"
                      >
                        {t('job.reload')}
                      </button>
                    </div>
                  ) : deliveryJobsQuery.isError ? (
                    <p className="mt-3 rounded-[var(--r-input)] border border-[var(--editorial-500)]/30 bg-[var(--editorial-500)]/10 p-3 text-xs text-[var(--editorial-400)]">
                      {t('job.cachedStatus')}
                    </p>
                  ) : null}

                  {activeDeliveryJob ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mt-4 rounded-[var(--r-input)] border border-primary-400/30 bg-primary-500/10 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-primary-100">
                            {activeDeliveryJob.status === 'queued'
                              ? t('job.queuedTitle')
                              : t('job.runningTitle')}
                          </p>
                          <p className="mt-1 text-xs text-text-secondary">
                            {activeDeliveryJob.stageLabel}
                          </p>
                        </div>
                        <span className="font-mono text-xs text-primary-200">
                          {normalizedProgress(activeDeliveryJob.progress)}%
                        </span>
                      </div>
                      <p className="mt-3 text-xs text-text-tertiary">
                        {t('job.taskId')}{' '}
                        <code className="font-mono text-text-primary">
                          {activeDeliveryJob.id}
                        </code>
                      </p>
                      <div
                        role="progressbar"
                        aria-label={t('job.progressAria')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={normalizedProgress(activeDeliveryJob.progress)}
                        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-inset"
                      >
                        <div
                          className="h-full rounded-full bg-primary-400 transition-[width]"
                          style={{
                            width: `${normalizedProgress(activeDeliveryJob.progress)}%`,
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(cancelDisabledReason)}
                        onClick={cancelActivePackage}
                        aria-describedby={
                          cancelDisabledReason ? 'delivery-cancel-reason' : undefined
                        }
                        className="kuiper-secondary-button mt-3 flex min-h-11 w-full items-center justify-center gap-2 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <AppIcon
                          name={cancelPackageMutation.isPending ? 'loader' : 'close'}
                          className={`h-4 w-4 ${cancelPackageMutation.isPending ? 'animate-spin' : ''}`}
                        />
                        {t('job.cancel')}
                      </button>
                      {cancelDisabledReason ? (
                        <p
                          id="delivery-cancel-reason"
                          className="mt-2 text-xs leading-5 text-text-tertiary"
                        >
                          {cancelDisabledReason}
                        </p>
                      ) : null}
                    </div>
                  ) : latestDeliveryFailed ? (
                    <div
                      role="alert"
                      className="mt-4 rounded-[var(--r-input)] border border-rose-500/30 bg-rose-500/10 p-3"
                    >
                      <p className="text-sm font-semibold text-rose-100">
                        {t('job.latestFailed')}
                      </p>
                      <p className="mt-1 text-xs text-rose-100/70">
                        {t('job.latestFailedDescription')}
                      </p>
                    </div>
                  ) : latestDeliveryCancelled ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mt-4 rounded-[var(--r-input)] border border-[var(--editorial-500)]/30 bg-[var(--editorial-500)]/10 p-3"
                    >
                      <p className="text-sm font-semibold text-[var(--editorial-400)]">
                        {t('job.latestCancelled')}
                      </p>
                    </div>
                  ) : null}

                  {deliveryQuery.isLoading && !deliveryQuery.data ? (
                    <div className="mt-4 h-12 animate-pulse rounded-[var(--r-input)] bg-surface-inset" />
                  ) : deliveryQuery.isError && !deliveryQuery.data ? (
                    <div role="alert" className="mt-4 rounded-[var(--r-input)] border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                      <p>{t('package.statusError')}</p>
                      <p className="mt-1 text-xs text-rose-100/70">
                        {errorMessage(deliveryQuery.error, t('states.unknownError'))}
                      </p>
                      <button
                        type="button"
                        onClick={() => void deliveryQuery.refetch()}
                        className="kuiper-secondary-button mt-3 min-h-11 px-3 text-sm"
                      >
                        {t('package.reloadStatus')}
                      </button>
                    </div>
                  ) : (
                    <>
                      {deliveryQuery.isError && deliveryQuery.data ? (
                        <p className="mt-3 rounded-[var(--r-input)] border border-[var(--editorial-500)]/30 bg-[var(--editorial-500)]/10 p-3 text-xs text-[var(--editorial-400)]">
                          {t('package.cachedStatus')}
                        </p>
                      ) : null}

                      {delivery ? (
                        <div className="mt-4 space-y-3 rounded-[var(--r-input)] border border-border-soft bg-surface-inset p-3">
                          <dl
                            aria-label={t('receipt.summaryAria')}
                            className="grid min-w-0 grid-cols-1 gap-3 text-xs sm:grid-cols-2"
                          >
                            <div className="min-w-0">
                              <dt className="text-text-tertiary">
                                {t('receipt.version')}
                              </dt>
                              <dd className="mt-1 font-mono text-text-primary">
                                {delivery.version}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-text-tertiary">
                                {t('receipt.createdAt')}
                              </dt>
                              <dd className="mt-1 break-all font-mono text-text-primary">
                                <time dateTime={delivery.createdAt}>
                                  {formatDeliveryCreatedAt(
                                    delivery.createdAt,
                                    locale,
                                  )}
                                </time>
                              </dd>
                            </div>
                            {delivery.version === 'v1' ? (
                              <>
                                <div className="min-w-0">
                                  <dt className="text-text-tertiary">
                                    {t('receipt.taskId')}
                                  </dt>
                                  <dd className="mt-1 break-all font-mono text-text-primary">
                                    {delivery.taskId}
                                  </dd>
                                </div>
                                <div className="min-w-0">
                                  <dt className="text-text-tertiary">
                                    {t('receipt.sourceFingerprint')}
                                  </dt>
                                  <dd className="mt-1 break-all font-mono text-text-primary">
                                    {delivery.sourceFingerprint}
                                  </dd>
                                </div>
                              </>
                            ) : null}
                          </dl>

                          {delivery.version === 'legacy' ? (
                            <p
                              role="status"
                              aria-live="polite"
                              className="rounded-[var(--r-input)] border border-[var(--editorial-500)]/30 bg-[var(--editorial-500)]/10 p-3 text-xs leading-5 text-[var(--editorial-400)]"
                            >
                              {t('receipt.legacyNotice')}
                            </p>
                          ) : delivery.stale ? (
                            <p
                              role="status"
                              aria-live="polite"
                              className="rounded-[var(--r-input)] border border-[var(--editorial-500)]/30 bg-[var(--editorial-500)]/10 p-3 text-xs leading-5 text-[var(--editorial-400)]"
                            >
                              {t('receipt.staleNotice')}
                            </p>
                          ) : (
                            <p
                              aria-live="polite"
                              className="text-xs font-semibold text-emerald-300"
                            >
                              {t('receipt.verified')}
                            </p>
                          )}

                          {delivery.version === 'v1' ? (
                            <dl
                              aria-label={t('receipt.manifestAria')}
                              className="divide-y divide-border-soft border-y border-border-soft text-xs"
                            >
                              {[
                                [
                                  t('receipt.fileCount'),
                                  t('receipt.fileCountValue', {
                                    count: delivery.manifest.fileCount,
                                  }),
                                ],
                                [
                                  t('receipt.selectedVideoCount'),
                                  t('receipt.selectedVideoCountValue', {
                                    count: delivery.manifest.selectedVideoCount,
                                  }),
                                ],
                                [
                                  t('receipt.multiShotVideoCount'),
                                  t('receipt.multiShotVideoCountValue', {
                                    count: delivery.manifest.multiShotVideoCount,
                                  }),
                                ],
                                [
                                  t('receipt.imageCount'),
                                  t('receipt.imageCountValue', {
                                    count: delivery.manifest.imageCount,
                                  }),
                                ],
                                [
                                  t('receipt.voiceAudioCount'),
                                  t('receipt.voiceAudioCountValue', {
                                    count: delivery.manifest.voiceAudioCount,
                                  }),
                                ],
                                [
                                  t('receipt.excludedVoiceLineCount'),
                                  t('receipt.excludedVoiceLineCountValue', {
                                    count: delivery.manifest.excludedVoiceLineCount,
                                  }),
                                ],
                                [t('receipt.script'), t('receipt.scriptIncluded')],
                                [t('receipt.checksum'), t('receipt.checksumSha256')],
                              ].map(([label, value]) => (
                                <div
                                  key={label}
                                  className="flex min-w-0 items-start justify-between gap-3 py-2.5"
                                >
                                  <dt className="text-text-tertiary">{label}</dt>
                                  <dd className="text-right text-text-primary">
                                    {value}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}
                        </div>
                      ) : null}

                      {safeDownloadUrl && delivery ? (
                        <a
                          href={safeDownloadUrl}
                          download={delivery.filename}
                          className={`${mediaWorkspaceClasses.deliverAction} mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--r-input)] border px-4 py-3 text-sm font-semibold transition-colors`}
                        >
                          <AppIcon name="download" className="h-4 w-4" />
                          {delivery.version === 'legacy'
                            ? t('package.downloadLegacyZip')
                            : priorDeliveryOnly || isStaleDelivery
                              ? t('package.downloadPreviousZip')
                              : t('package.downloadZip')}
                        </a>
                      ) : null}

                      {invalidReadyDelivery ? (
                        <div role="alert" className="mt-4 rounded-[var(--r-input)] border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                          {t('package.invalidDownload')}
                        </div>
                      ) : null}

                      {completedDeliveryAwaitingConfirmation ? (
                        <button
                          type="button"
                          disabled={
                            deliveryQuery.isFetching ||
                            isConfirmingCompletedDelivery
                          }
                          onClick={() => {
                            if (completedDeliveryJobKey) {
                              void confirmCompletedDelivery(
                                completedDeliveryJobKey,
                                latestDeliveryJob?.id ?? '',
                              )
                            }
                          }}
                          className="kuiper-secondary-button mt-3 flex min-h-12 w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <AppIcon
                            name={isConfirmingCompletedDelivery ? 'loader' : 'refresh'}
                            className={`h-4 w-4 ${isConfirmingCompletedDelivery ? 'animate-spin' : ''}`}
                          />
                          {t('package.reloadStatus')}
                        </button>
                      ) : !activeDeliveryJob ? (
                        <>
                          <button
                            type="button"
                            disabled={!canRequestPackage}
                            onClick={requestPackage}
                            aria-describedby={
                              requestDisabledReason ? 'delivery-create-reason' : undefined
                            }
                            className={`${safeDownloadUrl || invalidReadyDelivery ? 'kuiper-secondary-button' : mediaWorkspaceClasses.deliverAction} mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--r-input)] border px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40`}
                          >
                            <AppIcon
                              name={packageMutation.isPending
                                ? 'loader'
                                : safeDownloadUrl || invalidReadyDelivery
                                  ? 'refresh'
                                  : 'package'}
                              className={`h-4 w-4 ${packageMutation.isPending ? 'animate-spin' : ''}`}
                            />
                            {packageMutation.isPending
                              ? t('package.requesting')
                              : isStaleDelivery
                                ? t('package.createLatest')
                              : safeDownloadUrl || invalidReadyDelivery
                                ? t('package.recreate')
                                : t('package.create')}
                          </button>

                          {requestDisabledReason ? (
                            <p
                              id="delivery-create-reason"
                              className="mt-2 text-xs leading-5 text-text-tertiary"
                            >
                              {requestDisabledReason}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  )}

                  <p className="mt-3 rounded-[var(--r-input)] border border-border-soft bg-surface-inset p-3 text-xs leading-5 text-text-tertiary">
                    {t('package.downloadHint')}
                  </p>
                  {unresolvedPackageTransportError && !activeDeliveryJob ? (
                    <div role="alert" className="mt-3 rounded-[var(--r-input)] border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                      {errorMessage(packageMutation.error, t('package.errorFallback'))}
                    </div>
                  ) : null}
                  {cancelPackageMutation.isError ? (
                    <div role="alert" className="mt-3 rounded-[var(--r-input)] border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                      {errorMessage(
                        cancelPackageMutation.error,
                        t('job.cancelErrorFallback'),
                      )}
                    </div>
                  ) : null}
                </section>

                <nav aria-label={t('links.related')} className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <Link href={storyboardHref} className="kuiper-secondary-button flex min-h-11 items-center justify-center gap-2 px-3 py-2.5 text-sm">
                    <AppIcon name="clapperboard" className="h-4 w-4" />
                    {t('links.viewStoryboard')}
                  </Link>
                  <Link href={buildHref(`/${locale}/v2/workspace/${projectId}/script`)} className="kuiper-secondary-button flex min-h-11 items-center justify-center gap-2 px-3 py-2.5 text-sm">
                    <AppIcon name="fileText" className="h-4 w-4" />
                    {t('links.viewScript')}
                  </Link>
                </nav>
              </aside>
            </div>
          </>
        )}
      </main>
    </MediaWorkspaceSurface>
  )
}
