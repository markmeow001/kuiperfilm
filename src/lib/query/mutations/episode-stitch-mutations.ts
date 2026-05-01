/**
 * Phase 12.7.x — useStitchEpisodeMp4
 *
 * Submits an EPISODE_STITCH_MP4 task. Despite the legacy hook name,
 * the worker now packages all panel videos + storyboard images +
 * dialogue script into a zip (final cutting moved to CapCut/剪映 on
 * the user's machine — server-side ffmpeg was retired). On success
 * the worker writes the zip key to episode.stitchedVideoUrl. Caller
 * should invalidate project-data + storyboards queries to pick up
 * the new URL once the task completes.
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
        '打包素材包失敗',
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
