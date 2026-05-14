'use client'

/**
 * Phase 11.5 / Q-008: client-side query hook for fetching project styleProfile.
 *
 * Calls GET /api/projects/{projectId}/style-profile and is invalidated by
 * `useUpdateStyleProfile` after a successful save.
 */

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../keys'

export interface StyleProfileFetched {
  id: string
  stylePositivePrompt: string | null
  styleNegativePrompt: string | null
  /** Parsed JSON array of MediaObject ids; null when no reference images saved. */
  styleReferenceImages: string[] | null
  /** Which preset card the user clicked. Null when fully custom / never selected. */
  stylePresetKey: string | null
  /** Phase B — curated 29-style library selection. Null when never picked. */
  visualStyleId: string | null
  /** Phase B — 8-lighting preset selection. Null when never picked. */
  lightingPresetId: string | null
}

interface StyleProfileResponse {
  success: boolean
  data?: StyleProfileFetched
  error?: string
}

export function useStyleProfile(projectId: string | null | undefined) {
  return useQuery({
    enabled: typeof projectId === 'string' && projectId.length > 0,
    queryKey: typeof projectId === 'string' && projectId.length > 0
      ? queryKeys.project.styleProfile(projectId)
      : ['project', 'unknown', 'style-profile'],
    queryFn: async (): Promise<StyleProfileFetched> => {
      const response = await fetch(`/api/projects/${projectId}/style-profile`)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`Failed to fetch style profile (${response.status}): ${text}`)
      }
      const json = (await response.json()) as StyleProfileResponse
      if (!json.success || !json.data) {
        throw new Error(json.error || 'Style profile response missing data')
      }
      return json.data
    },
  })
}
