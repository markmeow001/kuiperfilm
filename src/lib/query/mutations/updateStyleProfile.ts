/**
 * Phase 11.5: client-side mutation for updating project styleProfile (3 columns).
 *
 * 调用 PATCH /api/projects/{projectId}/style-profile.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { invalidateQueryTemplates, requestJsonWithError } from './mutation-shared'

export interface StyleProfileUpdatePayload {
  stylePositivePrompt?: string | null
  styleNegativePrompt?: string | null
  styleReferenceImages?: string[] | null
}

export interface StyleProfileUpdateResponse {
  success: boolean
  data?: {
    id: string
    stylePositivePrompt: string | null
    styleNegativePrompt: string | null
    styleReferenceImages: string | null
  }
}

export function useUpdateStyleProfile(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: StyleProfileUpdatePayload): Promise<StyleProfileUpdateResponse> => {
      return await requestJsonWithError<StyleProfileUpdateResponse>(
        `/api/projects/${projectId}/style-profile`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        'Failed to update style profile',
      )
    },
    onSuccess: () => {
      // 重新拉取 project 资料（含 novelPromotionData.style*）+ styleProfile prefill cache
      invalidateQueryTemplates(queryClient, [
        queryKeys.project.detail(projectId),
        queryKeys.project.data(projectId),
        queryKeys.projectData(projectId),
        queryKeys.project.styleProfile(projectId),
      ])
    },
  })
}
