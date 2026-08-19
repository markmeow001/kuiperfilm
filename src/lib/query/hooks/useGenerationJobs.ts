'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import type { JobStatusFilter, JobView } from '@/lib/task/job-view'

export type GenerationJobsPage = {
  tasks: JobView[]
  nextCursor: string | null
}

export type GenerationJobsFilters = {
  projectId?: string | null
  episodeId?: string | null
  statuses?: JobStatusFilter[]
  types?: string[]
  limit?: number
  enabled?: boolean
}

export const ACTIVE_GENERATION_JOBS_REFETCH_MS = 3_000
export const IDLE_GENERATION_JOBS_REFETCH_MS = 15_000

export function generationJobsRefetchInterval(
  pages: readonly GenerationJobsPage[] | undefined,
): number {
  const hasActiveJob = pages?.some((page) =>
    page.tasks.some((task) => task.canCancel),
  ) ?? false
  return hasActiveJob
    ? ACTIVE_GENERATION_JOBS_REFETCH_MS
    : IDLE_GENERATION_JOBS_REFETCH_MS
}

function buildSearch(
  filters: Omit<GenerationJobsFilters, 'enabled'>,
  cursor: string | null,
): URLSearchParams {
  const search = new URLSearchParams({ scope: 'summary' })
  if (filters.projectId) search.set('projectId', filters.projectId)
  if (filters.episodeId) search.set('episodeId', filters.episodeId)
  if (cursor) search.set('cursor', cursor)
  search.set('limit', String(filters.limit ?? 50))
  for (const status of filters.statuses || []) {
    search.append('jobStatus', status)
  }
  for (const type of filters.types || []) {
    search.append('type', type)
  }
  return search
}

async function fetchGenerationJobs(
  filters: Omit<GenerationJobsFilters, 'enabled'>,
  cursor: string | null,
): Promise<GenerationJobsPage> {
  const response = await fetch(`/api/tasks?${buildSearch(filters, cursor)}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Generation jobs fetch failed: HTTP ${response.status}`)
  }
  const payload = await response.json() as Partial<GenerationJobsPage>
  return {
    tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
    nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
  }
}

export function useGenerationJobs(filters: GenerationJobsFilters = {}) {
  const statuses = [...(filters.statuses || [])].sort()
  const types = [...(filters.types || [])].sort()
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  const normalizedFilters = {
    projectId: filters.projectId || null,
    episodeId: filters.episodeId || null,
    statuses,
    types,
    limit,
  }

  return useInfiniteQuery({
    queryKey: queryKeys.generationJobs.list(normalizedFilters),
    enabled: filters.enabled ?? true,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => await fetchGenerationJobs(
      normalizedFilters,
      typeof pageParam === 'string' ? pageParam : null,
    ),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    staleTime: 3_000,
    refetchInterval: (query) => generationJobsRefetchInterval(query.state.data?.pages),
    refetchIntervalInBackground: false,
  })
}
