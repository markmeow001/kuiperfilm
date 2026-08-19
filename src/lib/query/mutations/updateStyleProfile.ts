/**
 * Phase 11.5: client-side mutation for updating project styleProfile (3 columns).
 *
 * 调用 PATCH /api/projects/{projectId}/style-profile.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import type { StyleProfileFetched } from '../hooks/useStyleProfile'
import { invalidateQueryTemplates, requestJsonWithError } from './mutation-shared'

export interface StyleProfileUpdatePayload {
  stylePositivePrompt?: string | null
  styleNegativePrompt?: string | null
  styleReferenceImages?: string[] | null
  stylePresetKey?: string | null
  visualStyleId?: string | null
  lightingPresetId?: string | null
}

export interface StyleProfileUpdateResponse {
  success: boolean
  data?: {
    id: string
    stylePositivePrompt: string | null
    styleNegativePrompt: string | null
    styleReferenceImages: string | null
    stylePresetKey: string | null
    visualStyleId: string | null
    lightingPresetId: string | null
  }
}

function normalizeReferenceImages(
  raw: string | null,
  previous: string[] | null,
): string[] | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      return previous
    }
    return parsed.length > 0 ? parsed : null
  } catch {
    return previous
  }
}

export function useUpdateStyleProfile(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: StyleProfileUpdatePayload): Promise<StyleProfileUpdateResponse> => {
      const response = await requestJsonWithError<StyleProfileUpdateResponse>(
        `/api/projects/${projectId}/style-profile`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        'Failed to update style profile',
      )
      if (!response.success || !response.data) {
        throw new Error('Style profile update response missing data')
      }
      return response
    },
    onSuccess: async (response) => {
      const updated = response.data
      if (!updated) return

      // PATCH returns the full saved row. Commit that server-confirmed value to
      // the exact query cache before announcing success; a failed background
      // refresh must not revert the visible selection to stale data.
      queryClient.setQueryData<StyleProfileFetched>(
        queryKeys.project.styleProfile(projectId),
        (previous) => ({
          id: updated.id,
          stylePositivePrompt: updated.stylePositivePrompt,
          styleNegativePrompt: updated.styleNegativePrompt,
          styleReferenceImages: normalizeReferenceImages(
            updated.styleReferenceImages,
            previous?.styleReferenceImages ?? null,
          ),
          stylePresetKey: updated.stylePresetKey,
          visualStyleId: updated.visualStyleId,
          lightingPresetId: updated.lightingPresetId,
        }),
      )

      // Keep downstream project views coherent, and await the invalidations so
      // mutateAsync only resolves after the last-good cache is established.
      await invalidateQueryTemplates(queryClient, [
        queryKeys.project.detail(projectId),
        queryKeys.project.data(projectId),
        queryKeys.projectData(projectId),
        queryKeys.project.styleProfile(projectId),
      ])
    },
  })
}
