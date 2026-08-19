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
  const invalidateProjectAssets = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projectAssets.all(projectId),
      exact: true,
    })
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projectAssets.props(projectId),
      exact: true,
    })
  }

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

/**
 * Phase R-3 (2026-05-22) — PATCH /api/novel-promotion/[projectId]/prop
 * with { propId, name }. Backend route runs propagatePropRename inside
 * a $transaction so panel.props JSON refs all get rewritten atomically.
 */
export function useUpdateProjectPropName(projectId: string) {
  const queryClient = useQueryClient()
  const invalidateProjectAssets = () =>
    invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

  return useMutation({
    mutationFn: async ({ propId, name }: { propId: string; name: string }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/prop`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propId, name }),
        },
        'Failed to update prop name',
      )
    },
    onSuccess: invalidateProjectAssets,
  })
}

/**
 * Edits the prop's `summary` field — short description used by the
 * image generator + multi-shot worker as anchor text. No panel
 * propagation needed (summary is not referenced from panel.props).
 */
export function useUpdateProjectPropSummary(projectId: string) {
  const queryClient = useQueryClient()
  const invalidateProjectAssets = () =>
    invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

  return useMutation({
    mutationFn: async ({ propId, summary }: { propId: string; summary: string }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/prop`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propId, summary }),
        },
        'Failed to update prop summary',
      )
    },
    onSuccess: invalidateProjectAssets,
  })
}

/**
 * Phase R-3 — DELETE /api/novel-promotion/[projectId]/prop?id=<propId>.
 * Backend handles cascade (panel.props strings stay as-is and resolve
 * to null at worker time — harmless).
 */
export function useDeleteProjectProp(projectId: string) {
  const queryClient = useQueryClient()
  const invalidateProjectAssets = () =>
    invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

  return useMutation({
    mutationFn: async ({ propId }: { propId: string }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/prop?id=${encodeURIComponent(propId)}`,
        { method: 'DELETE' },
        'Failed to delete prop',
      )
    },
    onSuccess: invalidateProjectAssets,
  })
}
