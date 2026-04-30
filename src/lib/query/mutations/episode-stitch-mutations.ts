/**
 * Phase 12.7.x — useStitchEpisodeMp4
 *
 * Submits an EPISODE_STITCH_MP4 task to assemble all panel videos in
 * an episode into a single mp4. Returns the task envelope; on success
 * the worker writes the resulting URL to episode.stitchedVideoUrl.
 * Caller should invalidate project-data + storyboards query to pick
 * up the new URL once the task completes.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { resolveTaskResponse } from '@/lib/task/client'
import {
  invalidateQueryTemplates,
  requestTaskResponseWithError,
} from './mutation-shared'

export function useStitchEpisodeMp4(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ episodeId }: { episodeId: string }) => {
      const response = await requestTaskResponseWithError(
        `/api/novel-promotion/${projectId}/episodes/${episodeId}/stitch-mp4`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        '匯出全集失敗',
      )
      return await resolveTaskResponse<{
        episodeId?: string
        outputUrl?: string
        panelCount?: number
      }>(response)
    },
    onSettled: () => {
      invalidateQueryTemplates(queryClient, [queryKeys.projectData(projectId)])
    },
  })
}
