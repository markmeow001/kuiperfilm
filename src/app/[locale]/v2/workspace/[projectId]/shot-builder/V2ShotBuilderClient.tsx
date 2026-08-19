'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { PageHeader } from '@/components/v2/PageHeader'
import { StatusPill } from '@/components/v2/StatusPill'
import {
  MediaWorkspaceSurface,
  mediaWorkspaceClasses,
} from '@/components/v2/MediaWorkspaceSurface'
import {
  VersionGallery,
  type VersionGalleryVersion,
} from '@/components/v2/VersionGallery'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import {
  useStoryboards,
  type StoryboardPanel,
} from '@/lib/query/hooks/useStoryboards'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { useEpisodePreservingHref } from '../hooks/useEpisodePreservingHref'

interface V2ShotBuilderClientProps {
  projectId: string
  locale: string
}

interface ProjectLike {
  novelPromotionData?: {
    videoModel?: string | null
    videoRatio?: string | null
    videoResolution?: string | null
  } | null
}

interface ShotSelection {
  storyboardId: string
  sceneIndex: number
  panel: StoryboardPanel
}

interface ShotVersion extends VersionGalleryVersion {
  imageUrl: string | null
}

function readCandidateImages(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter(
          (candidate): candidate is string =>
            typeof candidate === 'string' &&
            candidate.length > 0 &&
            !candidate.startsWith('PENDING:'),
        )
      : []
  } catch {
    return []
  }
}

export function V2ShotBuilderClient({
  projectId,
  locale,
}: V2ShotBuilderClientProps) {
  const t = useTranslations('v2Production.shotBuilder')
  const { currentEpisodeId, currentEpisode } = useCurrentEpisode(projectId)
  const buildHref = useEpisodePreservingHref()
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectLike | undefined
  const storyboardsQuery = useStoryboards(projectId, currentEpisodeId)
  const groups = useMemo(
    () => storyboardsQuery.data?.storyboards ?? [],
    [storyboardsQuery.data?.storyboards],
  )
  const shots = useMemo<ShotSelection[]>(
    () =>
      groups.flatMap((group, sceneIndex) =>
        group.panels.map((panel) => ({
          storyboardId: group.id,
          sceneIndex,
          panel,
        })),
      ),
    [groups],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected =
    shots.find((shot) => shot.panel.id === selectedId) ?? shots[0] ?? null
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null)
  const getShotStatus = (
    panel: StoryboardPanel,
  ): {
    label: string
    tone: 'neutral' | 'active' | 'success' | 'danger'
  } => {
    if (panel.imageErrorMessage)
      return { label: t('needsAttention'), tone: 'danger' }
    if (panel.videoTaskRunning || panel.imageTaskRunning)
      return { label: t('generating'), tone: 'active' }
    if (panel.videoUrl) return { label: t('videoDone'), tone: 'success' }
    if (panel.imageUrl) return { label: t('keyframeDone'), tone: 'active' }
    return { label: t('notCreated'), tone: 'neutral' }
  }

  useEffect(() => {
    if (selectedId && !shots.some((shot) => shot.panel.id === selectedId))
      setSelectedId(null)
  }, [selectedId, shots])

  useEffect(() => {
    setPreviewVersionId(null)
  }, [selected?.panel.id])

  const versions = useMemo<ShotVersion[]>(() => {
    if (!selected) return []
    const panel = selected.panel
    return [
      {
        id: `panel-${panel.id}`,
        name: t('currentKeyframe'),
        meta: panel.videoUrl ? t('linkedVideo') : t('fromStoryboard'),
        imageUrl: panel.imageUrl,
        approved: Boolean(panel.videoUrl),
      },
      ...readCandidateImages(panel.candidateImages).map((imageUrl, index) => ({
        id: `candidate-${panel.id}-${index}`,
        name: t('candidate', { number: index + 1 }),
        meta: t('candidateImage'),
        imageUrl,
        approved: false,
      })),
    ]
  }, [selected, t])
  const selectedVersion =
    versions.find((version) => version.id === previewVersionId) ??
    versions[0] ??
    null
  const status = selected ? getShotStatus(selected.panel) : null
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
          <div className="grid gap-4 xl:grid-cols-[240px_280px_minmax(0,1fr)]">
            <div className="h-[520px] animate-pulse rounded-[var(--r-card)] bg-overlay" />
            <div className="h-[520px] animate-pulse rounded-[var(--r-card)] bg-overlay" />
            <div className="h-[520px] animate-pulse rounded-[var(--r-card)] bg-overlay" />
          </div>
        </div>
      </MediaWorkspaceSurface>
    )
  }

  return (
    <MediaWorkspaceSurface>
      <main className="kuiper-workspace-page mx-auto w-full max-w-[1900px] px-[var(--workspace-gutter)] py-6 sm:py-8">
        <PageHeader
          tone="dark"
          className="border-b border-border-soft pb-5"
          eyebrow="SHOT BUILDER"
          title={t('title')}
          description={t('description')}
          context={<span>{currentEpisode?.name ?? t('currentEpisode')}</span>}
          actions={
            <>
              {!storyboardsQuery.isError || storyboardsQuery.data ? (
                <StatusPill
                  label={t('shotCount', { count: shots.length })}
                  tone={shots.length > 0 ? 'active' : 'neutral'}
                />
              ) : null}
              {!projectQuery.isError || projectQuery.data ? (
                <StatusPill
                  label={
                    project?.novelPromotionData?.videoRatio ?? t('ratioUnset')
                  }
                  tone="info"
                />
              ) : null}
            </>
          }
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="kuiper-segmented-control">
              <button
                type="button"
                aria-pressed="true"
                className="min-h-11 rounded-[var(--r-input)] bg-primary-500/15 px-4 text-sm font-semibold text-primary-200"
              >
                {t('storyboardMode')}
              </button>
              <button
                type="button"
                disabled
                aria-describedby="shot-builder-ai-plan-notice"
                className="min-h-11 cursor-not-allowed rounded-[var(--r-input)] px-4 text-sm font-semibold text-text-tertiary opacity-70"
              >
                {t('aiPlan')} · {t('planned')}
              </button>
            </div>
            <p
              id="shot-builder-ai-plan-notice"
              className="mt-2 max-w-xl text-xs leading-5 text-text-tertiary"
            >
              {t('aiPlanNotice')}
            </p>
          </div>
          <Link
            href={storyboardHref}
            className="kuiper-secondary-button inline-flex min-h-11 items-center gap-2 px-4 text-sm"
          >
            <AppIcon name="image" className="h-4 w-4" />
            {t('back')}
          </Link>
        </div>

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
          shots.length === 0 ? (
            <section className="mt-5 rounded-[var(--r-card)] border border-dashed border-border-soft bg-surface-raised p-8 text-center">
              <AppIcon
                name="clapperboard"
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
                {t('enterStoryboard')}
                <AppIcon name="arrowRight" className="h-4 w-4" />
              </Link>
            </section>
          ) : (
            <div className="mt-5 grid min-h-[640px] gap-4 xl:grid-cols-[220px_280px_minmax(0,1fr)]">
              <aside className="kuiper-surface-card h-fit overflow-hidden xl:sticky xl:top-4">
                <div className="border-b border-border-soft px-4 py-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-300">
                    Scenes
                  </p>
                  <h2 className="mt-1 text-sm font-semibold text-text-primary">
                    {t('scenes')}
                  </h2>
                </div>
                <div className="flex gap-2 overflow-x-auto p-2 xl:block xl:max-h-[520px] xl:space-y-1 xl:overflow-y-auto">
                  {groups.map((group, index) => {
                    const active = selected?.sceneIndex === index
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() =>
                          setSelectedId(group.panels[0]?.id ?? null)
                        }
                        className={`min-h-12 min-w-[150px] rounded-[var(--r-input)] px-3 py-2 text-left text-sm transition-colors xl:w-full ${
                          active
                            ? 'bg-primary-500/15 text-primary-100'
                            : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
                        }`}
                      >
                        <span className="block font-mono text-[11px] text-text-tertiary">
                          SCENE {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="mt-0.5 block truncate font-semibold">
                          {t('sceneShotCount', { count: group.panels.length })}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </aside>

              <aside className="kuiper-surface-card h-fit overflow-hidden xl:sticky xl:top-4">
                <div className="border-b border-border-soft px-4 py-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-300">
                    Shot list
                  </p>
                  <h2 className="mt-1 text-sm font-semibold text-text-primary">
                    {t('shotList')}
                  </h2>
                </div>
                <div className="grid max-h-[560px] grid-cols-2 gap-2 overflow-y-auto p-2 sm:grid-cols-3 xl:grid-cols-1">
                  {shots
                    .filter((shot) => shot.sceneIndex === selected?.sceneIndex)
                    .map((shot, index) => {
                      const itemStatus = getShotStatus(shot.panel)
                      const active = shot.panel.id === selected?.panel.id
                      return (
                        <button
                          key={shot.panel.id}
                          type="button"
                          onClick={() => setSelectedId(shot.panel.id)}
                          className={`overflow-hidden rounded-[var(--r-input)] border text-left transition-colors ${
                            active
                              ? 'border-primary-400 bg-primary-500/10'
                              : 'border-border-soft bg-surface-inset hover:border-border-primary'
                          }`}
                        >
                          <div
                            className={`aspect-video ${mediaWorkspaceClasses.mediaWell}`}
                          >
                            {shot.panel.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={shot.panel.imageUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="grid h-full place-items-center">
                                <AppIcon
                                  name="image"
                                  className="h-5 w-5 text-text-tertiary"
                                />
                              </div>
                            )}
                          </div>
                          <div className="p-2.5">
                            <p className="font-mono text-[11px] text-text-tertiary">
                              SHOT {String(index + 1).padStart(2, '0')}
                            </p>
                            <p className="mt-1 truncate text-xs font-semibold text-text-primary">
                              {itemStatus.label}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                </div>
              </aside>

              {selected ? (
                <section className="min-w-0 space-y-4">
                  <article className="kuiper-surface-card overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary-300">
                          Selected shot
                        </p>
                        <h2 className="mt-1 text-base font-semibold text-text-primary">
                          {t('shot', {
                            number:
                              selected.panel.panelNumber ||
                              selected.panel.panelIndex + 1,
                          })}
                        </h2>
                      </div>
                      {status ? (
                        <StatusPill label={status.label} tone={status.tone} />
                      ) : null}
                    </div>
                    <div
                      className={`relative aspect-video min-h-[260px] ${mediaWorkspaceClasses.stage}`}
                    >
                      {selected.panel.videoUrl ? (
                        <video
                          src={selected.panel.videoUrl}
                          controls
                          className="h-full w-full object-contain"
                        />
                      ) : selectedVersion?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selectedVersion.imageUrl}
                          alt={t('previewAlt')}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-sm text-text-tertiary">
                          {t('noPreviewMedia')}
                        </div>
                      )}
                    </div>
                  </article>

                  <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
                    <article className="kuiper-surface-card p-4 sm:p-5">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-text-primary">
                          {t('contract')}
                        </h2>
                        <span className="text-xs text-text-tertiary">
                          {t('source')}
                        </span>
                      </div>
                      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold text-text-tertiary">
                            Prompt
                          </dt>
                          <dd className="mt-1 rounded-[var(--r-input)] border border-border-soft bg-surface-inset p-3 text-sm leading-6 text-text-primary">
                            {selected.panel.videoPrompt || t('promptMissing')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-text-tertiary">
                            {t('characterReferences')}
                          </dt>
                          <dd className="mt-1 text-sm text-text-primary">
                            {selected.panel.characters
                              ?.map((character) => character.name)
                              .join(
                                locale.toLowerCase().startsWith('en')
                                  ? ', '
                                  : '、',
                              ) || t('unbound')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-text-tertiary">
                            {t('locationReference')}
                          </dt>
                          <dd className="mt-1 text-sm text-text-primary">
                            {selected.panel.location || t('unbound')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-text-tertiary">
                            {t('model')}
                          </dt>
                          <dd className="mt-1 break-words text-sm text-text-primary">
                            {project?.novelPromotionData?.videoModel ||
                              t('unset')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-text-tertiary">
                            {t('output')}
                          </dt>
                          <dd className="mt-1 text-sm text-text-primary">
                            {project?.novelPromotionData?.videoRatio ?? '—'} ·{' '}
                            {project?.novelPromotionData?.videoResolution ??
                              '—'}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-5 rounded-[var(--r-input)] border border-primary-400/25 bg-primary-500/10 p-3 text-sm leading-6 text-primary-200/85">
                        {t('generationBoundary')}
                      </div>
                      <Link
                        href={storyboardHref}
                        className="kuiper-primary-button mt-4 inline-flex min-h-11 items-center gap-2 px-5 text-sm font-semibold"
                      >
                        {t('generateInStoryboard')}
                        <AppIcon name="arrowRight" className="h-4 w-4" />
                      </Link>
                    </article>

                    <aside className="kuiper-surface-card p-4">
                      <h2 className="text-sm font-semibold text-text-primary">
                        {t('deliveryCheck')}
                      </h2>
                      <ul className="mt-3 space-y-2 text-sm">
                        {[
                          [t('keyframe'), Boolean(selected.panel.imageUrl)],
                          [
                            t('characterReferences'),
                            Boolean(selected.panel.characters?.length),
                          ],
                          [
                            t('locationReference'),
                            Boolean(selected.panel.location),
                          ],
                          [
                            t('motionPrompt'),
                            Boolean(selected.panel.videoPrompt),
                          ],
                        ].map(([label, ready]) => (
                          <li
                            key={String(label)}
                            className="flex items-center justify-between gap-3 rounded-[var(--r-input)] bg-surface-inset px-3 py-2.5"
                          >
                            <span className="text-text-secondary">{label}</span>
                            <span
                              className={
                                ready ? 'text-emerald-300' : 'text-amber-200'
                              }
                            >
                              {ready ? t('complete') : t('incomplete')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </aside>
                  </div>

                  <article className="kuiper-surface-card p-4 sm:p-5">
                    <h2 className="mb-4 text-sm font-semibold text-text-primary">
                      {t('versions')}
                    </h2>
                    <VersionGallery
                      appearance="editor"
                      versions={versions}
                      selectedId={selectedVersion?.id}
                      onSelect={(version) => setPreviewVersionId(version.id)}
                      ariaLabel={t('versionsAria')}
                      locale={locale}
                      labels={{
                        selected: t('previewing'),
                        current: t('previewing'),
                        select: t('previewVersion'),
                      }}
                      renderPreview={(version) =>
                        version.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={version.imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-xs text-text-tertiary">
                            {t('noPreview')}
                          </div>
                        )
                      }
                    />
                  </article>
                </section>
              ) : null}
            </div>
          )
        ) : null}
      </main>
    </MediaWorkspaceSurface>
  )
}
