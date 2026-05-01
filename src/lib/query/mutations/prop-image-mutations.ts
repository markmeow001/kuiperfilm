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
