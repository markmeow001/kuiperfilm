'use client'

/**
 * Stage-navigation helper that preserves the active episode across
 * stage tabs.
 *
 * Background: useCurrentEpisode reads `?episode=<id>` out of the URL.
 * If a Link / router.push to another stage drops the search param,
 * the destination falls back to "first episode in project" (line 67
 * of useCurrentEpisode.ts) — which is what was happening when the
 * user worked on episode 4, hit "下一步 → 劇本拆解", and watched the
 * subjects page open on episode 1 instead.
 *
 * Pattern:
 *   const buildHref = useEpisodePreservingHref()
 *   <Link href={buildHref(`/${locale}/v2/workspace/${projectId}/subjects`)}>
 *
 * If the current URL has ?episode=xxx, the resulting href will too.
 * If it doesn't (e.g. first visit, episode is implicit-default),
 * the helper appends nothing and the destination still works the
 * same way it did before.
 */
import { useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

export function useEpisodePreservingHref(): (path: string) => string {
  const searchParams = useSearchParams()
  return useCallback(
    (path: string) => {
      const episodeId = searchParams?.get('episode')
      if (!episodeId) return path
      // Don't double-up the param if the caller already put one in.
      if (path.includes('episode=')) return path
      const sep = path.includes('?') ? '&' : '?'
      return `${path}${sep}episode=${encodeURIComponent(episodeId)}`
    },
    [searchParams],
  )
}
