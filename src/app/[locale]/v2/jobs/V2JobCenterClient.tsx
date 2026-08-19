'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { PageHeader } from '@/components/v2/PageHeader'
import { StatusPill } from '@/components/v2/StatusPill'
import { UiStatePanel } from '@/components/v2/UiStatePanel'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { useGenerationJobs } from '@/lib/query/hooks/useGenerationJobs'
import { useCancelGenerationJob } from '@/lib/query/mutations/task-mutations'
import type { JobView } from '@/lib/task/job-view'
import { V2StudioUtilityShell } from '../V2StudioUtilityShell'
import { JobCenterCard } from './JobCenterCard'
import type { JobCenterFilter } from './job-center-format'

interface V2JobCenterClientProps {
  locale: string
  initialProjectId: string | null
}

interface ProjectOption {
  id: string
  name: string
  canEdit: boolean
}

interface ProjectOptionsResponse {
  projects?: ProjectOption[]
  nextCursor?: string | null
}

const STATUS_FILTERS: readonly JobCenterFilter[] = [
  'all',
  'active',
  'completed',
  'failed',
  'cancelled',
]

async function fetchProjectOptions(): Promise<ProjectOption[]> {
  const projects = new Map<string, ProjectOption>()
  let cursor: string | null = null

  do {
    const params = new URLSearchParams({ limit: '200' })
    if (cursor) params.set('cursor', cursor)
    const response = await fetch(`/api/projects/options?${params}`, {
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error(`Project options fetch failed: HTTP ${response.status}`)
    }
    const payload = await response.json() as ProjectOptionsResponse
    for (const project of payload.projects ?? []) {
      projects.set(project.id, project)
    }
    cursor = typeof payload.nextCursor === 'string' && payload.nextCursor
      ? payload.nextCursor
      : null
  } while (cursor)

  return Array.from(projects.values())
}

const VIRTUAL_PROJECT_IDS = new Set([
  'playground',
  'asset-hub',
  'global-asset-hub',
  'system',
])

export function V2JobCenterClient({
  locale,
  initialProjectId,
}: V2JobCenterClientProps) {
  const t = useTranslations('v2Jobs')
  const router = useRouter()
  const [projectId, setProjectId] = useState(initialProjectId)
  const [statusFilter, setStatusFilter] = useState<JobCenterFilter>('all')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [episodeFilter, setEpisodeFilter] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const projectAccess = useProjectAccess(projectId)
  const canLoadJobs = !projectId || (!projectAccess.isLoading && projectAccess.allowed)
  const jobsQuery = useGenerationJobs({
    projectId,
    episodeId: episodeFilter,
    statuses: statusFilter === 'all' ? [] : [statusFilter],
    types: typeFilter ? [typeFilter] : [],
    limit: 24,
    enabled: canLoadJobs,
  })
  const cancelJob = useCancelGenerationJob(projectId)
  const projectsQuery = useQuery({
    queryKey: ['generation-jobs', 'project-options'] as const,
    queryFn: fetchProjectOptions,
    staleTime: 60_000,
  })

  useEffect(() => {
    const update = () => setOnline(window.navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const jobs = useMemo(
    () => jobsQuery.data?.pages.flatMap((page) => page.tasks) ?? [],
    [jobsQuery.data],
  )
  const taskTypes = useMemo(() => {
    const labels = new Map<string, string>()
    if (typeFilter) labels.set(typeFilter, typeFilter)
    for (const job of jobs) labels.set(job.type, job.typeLabel)
    return Array.from(labels, ([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }, [jobs, typeFilter])
  const episodeIds = useMemo(() => {
    const values = new Set<string>()
    if (episodeFilter) values.add(episodeFilter)
    for (const job of jobs) {
      if (job.episodeId) values.add(job.episodeId)
    }
    return Array.from(values).sort()
  }, [episodeFilter, jobs])
  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  )
  const projectEditability = useMemo(
    () => new Map(projects.map((project) => [project.id, project.canEdit])),
    [projects],
  )
  const currentProjectKnown = projectId
    ? projects.some((project) => project.id === projectId)
    : true
  const isFiltered = statusFilter !== 'all' || !!typeFilter || !!episodeFilter
  const showBlockingPermission = !!projectId
    && !projectAccess.isLoading
    && !projectAccess.isError
    && !projectAccess.allowed

  function changeProject(nextProjectId: string) {
    const normalized = nextProjectId || null
    setProjectId(normalized)
    setTypeFilter(null)
    setEpisodeFilter(null)
    const href = normalized
      ? `/${locale}/v2/jobs?projectId=${encodeURIComponent(normalized)}`
      : `/${locale}/v2/jobs`
    router.replace(href, { scroll: false })
  }

  function clearFilters() {
    setStatusFilter('all')
    setTypeFilter(null)
    setEpisodeFilter(null)
  }

  return (
    <V2StudioUtilityShell
      locale={locale}
      title={t('header.topbar')}
      tagline={t('header.tagline')}
    >
      <main className="kuiper-dashboard-main mx-auto max-w-[1540px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        <PageHeader
          eyebrow={t('header.eyebrow')}
          title={t('header.title')}
          description={t('header.description')}
          context={(
            <>
              <StatusPill
                tone={jobs.some((job) => job.canCancel) ? 'active' : 'neutral'}
                label={t('filters.loadedCount', { count: jobs.length })}
              />
              <span>{projectId ? t('scope.projectHelp') : t('scope.personalHelp')}</span>
            </>
          )}
        />

        <section
          aria-label={t('filters.label')}
          className="mt-7 rounded-[14px] border border-[var(--production-border)] bg-[var(--production-surface)] p-4 sm:p-5"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(240px,1.25fr)_minmax(180px,0.8fr)_minmax(180px,0.8fr)_auto] lg:items-end">
            <label className="min-w-0">
              <span className="mb-2 block text-[12px] font-semibold text-[var(--production-ink-muted)]">
                {t('scope.label')}
              </span>
              <select
                value={projectId ?? ''}
                onChange={(event) => changeProject(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-[var(--production-border)] bg-[var(--production-muted)] px-3 text-[14px] text-[var(--production-ink)] outline-none focus:border-[var(--production-focus)] focus:ring-4 focus:ring-[rgba(85,175,192,0.12)]"
              >
                <option value="">{t('scope.personal')}</option>
                {!currentProjectKnown && projectId ? (
                  <option value={projectId}>{projectId}</option>
                ) : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name || project.id}
                  </option>
                ))}
              </select>
            </label>

            <label className="min-w-0">
              <span className="mb-2 block text-[12px] font-semibold text-[var(--production-ink-muted)]">
                {t('filters.type')}
              </span>
              <select
                value={typeFilter ?? ''}
                onChange={(event) => setTypeFilter(event.target.value || null)}
                className="min-h-11 w-full rounded-xl border border-[var(--production-border)] bg-[var(--production-muted)] px-3 text-[14px] text-[var(--production-ink)] outline-none focus:border-[var(--production-focus)] focus:ring-4 focus:ring-[rgba(85,175,192,0.12)]"
              >
                <option value="">{t('filters.allTypes')}</option>
                {taskTypes.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>

            <label className="min-w-0">
              <span className="mb-2 block text-[12px] font-semibold text-[var(--production-ink-muted)]">
                {t('filters.episode')}
              </span>
              <select
                value={episodeFilter ?? ''}
                onChange={(event) => setEpisodeFilter(event.target.value || null)}
                className="min-h-11 w-full rounded-xl border border-[var(--production-border)] bg-[var(--production-muted)] px-3 text-[14px] text-[var(--production-ink)] outline-none focus:border-[var(--production-focus)] focus:ring-4 focus:ring-[rgba(85,175,192,0.12)]"
              >
                <option value="">{t('filters.allEpisodes')}</option>
                {episodeIds.map((episodeId) => (
                  <option key={episodeId} value={episodeId}>{episodeId}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              disabled={!isFiltered}
              onClick={clearFilters}
              className="kuiper-dashboard-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <AppIcon name="eraser" className="h-4 w-4" />
              {t('filters.clear')}
            </button>
          </div>

          <div
            role="group"
            aria-label={t('filters.label')}
            className="mt-4 flex gap-2 overflow-x-auto border-t border-[var(--production-border)] pt-4"
          >
            {STATUS_FILTERS.map((filter) => {
              const active = statusFilter === filter
              return (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(filter)}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] ${
                    active
                      ? 'border-[var(--process-cyan)] bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
                      : 'border-[var(--production-border)] text-[var(--production-ink-muted)] hover:text-[var(--production-ink)]'
                  }`}
                >
                  {t(`filters.${filter}`)}
                </button>
              )
            })}
          </div>

          {projectsQuery.isLoading ? (
            <p className="mt-3 text-[12px] text-[var(--production-ink-muted)]">
              {t('scope.loading')}
            </p>
          ) : null}
          {projectsQuery.isError ? (
            <p role="status" className="mt-3 text-[12px] text-amber-200">
              {t('scope.loadError')}
            </p>
          ) : null}
        </section>

        <div className="mt-6">
          {projectId && projectAccess.isLoading ? (
            <UiStatePanel
              state="loading"
              locale={locale}
              title={t('states.loadingTitle')}
              description={t('states.loadingDescription')}
            />
          ) : projectId && projectAccess.isError ? (
            <UiStatePanel
              state="error"
              locale={locale}
              title={t('states.errorTitle')}
              description={t('states.errorDescription')}
              details={projectAccess.error?.message}
              primaryAction={(
                <button
                  type="button"
                  onClick={() => void projectAccess.refetch()}
                  className="kuiper-dashboard-primary min-h-11 px-4 text-[13px]"
                >
                  {t('states.retry')}
                </button>
              )}
            />
          ) : showBlockingPermission ? (
            <UiStatePanel
              state="permission"
              locale={locale}
              title={t('states.permissionTitle')}
              description={t('states.permissionDescription')}
            />
          ) : jobsQuery.isLoading ? (
            <UiStatePanel
              state="loading"
              locale={locale}
              title={t('states.loadingTitle')}
              description={t('states.loadingDescription')}
            />
          ) : jobsQuery.isError && jobs.length === 0 ? (
            <UiStatePanel
              state={online ? 'error' : 'offline'}
              locale={locale}
              title={online ? t('states.errorTitle') : undefined}
              description={online ? t('states.errorDescription') : undefined}
              details={jobsQuery.error instanceof Error ? jobsQuery.error.message : undefined}
              primaryAction={(
                <button
                  type="button"
                  onClick={() => void jobsQuery.refetch()}
                  className="kuiper-dashboard-primary min-h-11 px-4 text-[13px]"
                >
                  {t('states.retry')}
                </button>
              )}
            />
          ) : jobs.length === 0 ? (
            <UiStatePanel
              state="empty"
              locale={locale}
              title={isFiltered ? t('states.filteredEmptyTitle') : t('states.emptyTitle')}
              description={isFiltered
                ? t('states.filteredEmptyDescription')
                : t('states.emptyDescription')}
              primaryAction={isFiltered ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="kuiper-dashboard-secondary min-h-11 px-4 text-[13px]"
                >
                  {t('filters.clear')}
                </button>
              ) : undefined}
            />
          ) : (
            <>
              {jobsQuery.isError ? (
                <UiStatePanel
                  state={online ? 'stale' : 'offline'}
                  locale={locale}
                  compact
                  className="mb-5"
                  primaryAction={(
                    <button
                      type="button"
                      onClick={() => void jobsQuery.refetch()}
                      className="kuiper-dashboard-secondary min-h-11 px-4 text-[13px]"
                    >
                      {t('states.retry')}
                    </button>
                  )}
                />
              ) : null}

              <div className="grid gap-4 xl:grid-cols-2">
                {jobs.map((job: JobView) => (
                  <JobCenterCard
                    key={job.id}
                    job={job}
                    locale={locale}
                    allowCancel={projectId
                      ? projectAccess.canEdit
                      : VIRTUAL_PROJECT_IDS.has(job.projectId)
                        || projectEditability.get(job.projectId) === true}
                    onCancel={async (taskId) => await cancelJob.mutateAsync(taskId)}
                  />
                ))}
              </div>

              <div className="mt-7 flex justify-center">
                {jobsQuery.hasNextPage ? (
                  <button
                    type="button"
                    disabled={jobsQuery.isFetchingNextPage}
                    onClick={() => void jobsQuery.fetchNextPage()}
                    className="kuiper-dashboard-secondary inline-flex min-h-11 items-center gap-2 px-5 text-[13px] disabled:cursor-wait disabled:opacity-60"
                  >
                    {jobsQuery.isFetchingNextPage ? (
                      <AppIcon name="loader" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <AppIcon name="arrowDownCircle" className="h-4 w-4" />
                    )}
                    {jobsQuery.isFetchingNextPage
                      ? t('pagination.loading')
                      : t('pagination.loadMore')}
                  </button>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--production-ink-muted)]">
                    {t('pagination.end')}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </V2StudioUtilityShell>
  )
}
