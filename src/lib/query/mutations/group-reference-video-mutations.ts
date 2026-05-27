/**
 * Phase S (2026-05-27) — per-group motion / camera reference video.
 *
 * POST    /api/novel-promotion/[projectId]/storyboard/[storyboardId]/reference-video
 *   - multipart/form-data with `file`
 *   - MIME gate: mp4 / mov / webm
 *   - Size gate: ≤50 MB
 *   - Duration gate is enforced client-side (≤15s) before this hook fires
 *
 * DELETE  /api/novel-promotion/[projectId]/storyboard/[storyboardId]/reference-video
 *
 * onSuccess invalidates the storyboard / panel snapshot so the GroupCard
 * preview re-fetches with the new (or cleared) referenceVideoUrl.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { invalidateQueryTemplates, requestJsonWithError } from './mutation-shared'

interface UploadGroupReferenceVideoResult {
  success: boolean
  key: string
  signedUrl: string
}

export function useUploadGroupReferenceVideo(projectId: string) {
  const queryClient = useQueryClient()
  const invalidate = (episodeId?: string) =>
    invalidateQueryTemplates(
      queryClient,
      [
        queryKeys.projectData(projectId),
        ...(episodeId ? [queryKeys.storyboards.all(episodeId)] : []),
      ],
    )

  return useMutation({
    mutationFn: async ({
      storyboardId,
      file,
    }: {
      storyboardId: string
      file: File
      episodeId?: string
    }): Promise<UploadGroupReferenceVideoResult> => {
      const formData = new FormData()
      formData.append('file', file)
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/storyboard/${storyboardId}/reference-video`,
        {
          method: 'POST',
          body: formData,
        },
        '上傳動作參考視頻失敗',
      ) as UploadGroupReferenceVideoResult
    },
    onSuccess: (_data, { episodeId }) => invalidate(episodeId),
  })
}

export function useDeleteGroupReferenceVideo(projectId: string) {
  const queryClient = useQueryClient()
  const invalidate = (episodeId?: string) =>
    invalidateQueryTemplates(
      queryClient,
      [
        queryKeys.projectData(projectId),
        ...(episodeId ? [queryKeys.storyboards.all(episodeId)] : []),
      ],
    )

  return useMutation({
    mutationFn: async ({
      storyboardId,
    }: {
      storyboardId: string
      episodeId?: string
    }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/storyboard/${storyboardId}/reference-video`,
        { method: 'DELETE' },
        '清除動作參考視頻失敗',
      )
    },
    onSuccess: (_data, { episodeId }) => invalidate(episodeId),
  })
}
