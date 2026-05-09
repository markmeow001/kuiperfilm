'use client'

/**
 * Phase 12.x.x — v2 EpisodeTabBar URL state.
 *
 * Source of truth for "which episode is the user looking at" in v2 is
 * the URL search param `?episode=<id>`. Every v2 page reads through this
 * hook so navigation between pages preserves the selection, and the
 * EpisodeTabBar in the workspace shell drives the same state.
 *
 * Resolution order:
 *  1. `?episode=<id>` if it matches a real episode in the project
 *  2. First episode in the project (sorted by episodeNumber)
 *  3. null when the project has no episodes yet
 */

import { useCallback, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useProjectData } from '@/lib/query/hooks/useProjectData'

export interface CurrentEpisode {
  id: string
  episodeNumber: number
  name: string
  novelText: string | null
}

interface ProjectShape {
  novelPromotionData?: {
    episodes?: Array<{
      id?: string
      episodeNumber?: number | null
      name?: string | null
      novelText?: string | null
    }> | null
  } | null
}

function sortByEpisodeNumber(
  episodes: NonNullable<NonNullable<ProjectShape['novelPromotionData']>['episodes']>,
): CurrentEpisode[] {
  return episodes
    .filter((ep): ep is { id: string } & Omit<NonNullable<typeof ep>, 'id'> => typeof ep.id === 'string')
    .map((ep, idx) => ({
      id: ep.id,
      episodeNumber: typeof ep.episodeNumber === 'number' ? ep.episodeNumber : idx + 1,
      name: typeof ep.name === 'string' && ep.name ? ep.name : `第 ${idx + 1} 集`,
      novelText: typeof ep.novelText === 'string' ? ep.novelText : null,
    }))
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
}

export function useCurrentEpisode(projectId: string) {
  const projectQuery = useProjectData(projectId)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const project = projectQuery.data as ProjectShape | undefined
  const rawEpisodes = project?.novelPromotionData?.episodes
  const episodes = useMemo(() => sortByEpisodeNumber(rawEpisodes ?? []), [rawEpisodes])

  const requestedId = searchParams?.get('episode') ?? null
  const matched = requestedId
    ? episodes.find((ep) => ep.id === requestedId) ?? null
    : null
  const fallback = episodes.length > 0 ? episodes[0] : null
  const current = matched ?? fallback

  const setCurrentEpisode = useCallback(
    (episodeId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('episode', episodeId)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  return {
    isLoading: projectQuery.isLoading,
    episodes,
    currentEpisodeId: current?.id ?? null,
    currentEpisode: current,
    setCurrentEpisode,
  }
}
