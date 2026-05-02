/**
 * Phase 11.3 Stage C — prop image mutation hooks.
 *
 * Mirror of the location-image-mutations pattern, scoped to props.
 *
 *   useGenerateProjectPropImage(projectId)
 *     POSTs /api/.../generate-image type='prop' with the prop id.
 *     onSuccess invalidates the projectAssets cache so the new
 *     imageUrl surfaces in the V2 道具 grid.
 *
 *   useRegenerateSinglePropImage(projectId)
 *     Same idea via /api/.../regenerate-single-image. Used for the
 *     "重新生成圖" button on a prop card after an initial image exists.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { invalidateQueryTemplates, requestJsonWithError } from './mutation-shared'

export function useGenerateProjectPropImage(projectId: string) {
  const queryClient = useQueryClient()
  const invalidateProjectAssets = () =>
    invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

  return useMutation({
    mutationFn: async ({ propId }: { propId: string }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/generate-image`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'prop',
            id: propId,
          }),
        },
        'Failed to generate prop image',
      )
    },
    onSettled: invalidateProjectAssets,
  })
}

export function useRegenerateSinglePropImage(projectId: string) {
  const queryClient = useQueryClient()
  const invalidateProjectAssets = () =>
    invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

  return useMutation({
    mutationFn: async ({ propId }: { propId: string }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/regenerate-single-image`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'prop',
            id: propId,
          }),
        },
        'Failed to regenerate prop image',
      )
    },
    onSettled: invalidateProjectAssets,
  })
}

/**
 * Upload a user-supplied image and use it as the prop's imageUrl.
 * Mirrors useUploadProjectLocationImage. POSTs multipart to
 * /api/.../upload-asset-image with type='prop'. The endpoint
 * processes the file (label bar + sharp re-encode), uploads to COS,
 * and overwrites NovelPromotionProp.imageUrl with the new key. Read-
 * side signing is handled by attachMediaFieldsToProp on the GET so
 * the FE receives a usable URL right after the cache invalidates.
 */
export function useUploadProjectPropImage(projectId: string) {
  const queryClient = useQueryClient()
  const invalidateProjectAssets = () =>
    invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

  return useMutation({
    mutationFn: async (params: { file: File; propId: string; labelText?: string }) => {
      const formData = new FormData()
      formData.append('file', params.file)
      formData.append('type', 'prop')
      formData.append('id', params.propId)
      if (params.labelText) formData.append('labelText', params.labelText)
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/upload-asset-image`,
        { method: 'POST', body: formData },
        'Failed to upload prop image',
      )
    },
    onSuccess: invalidateProjectAssets,
  })
}
