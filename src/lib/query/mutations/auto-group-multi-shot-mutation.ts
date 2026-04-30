/**
 * Phase 12.5.3 — useAutoGroupMultiShot
 *
 * Synchronous LLM call (no task queue): returns groups + persists
 * panel.multiShotGroupId / multiShotGroupOrder server-side. After
 * success the storyboards query should be invalidated so the
 * storyboard strip re-renders with the new colour-coding.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import {
  invalidateQueryTemplates,
  requestJsonWithError,
} from './mutation-shared'

export interface MultiShotGroup {
  id: string
  panelIds: string[]
  reason?: string
}

export interface AutoGroupResult {
  groups: MultiShotGroup[]
  panelCount: number
  groupedCount: number
  modelUsed: string
}

export function useAutoGroupMultiShot(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ episodeId }: { episodeId: string }): Promise<AutoGroupResult> => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/episodes/${episodeId}/auto-group-multi-shot`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        '智能切組失敗',
      ) as AutoGroupResult
    },
    onSuccess: (_data, { episodeId }) => {
      invalidateQueryTemplates(queryClient, [
        queryKeys.projectData(projectId),
        queryKeys.storyboards.all(episodeId),
      ])
    },
  })
}
