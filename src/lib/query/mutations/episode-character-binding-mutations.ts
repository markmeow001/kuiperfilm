import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { invalidateQueryTemplates, requestJsonWithError } from './mutation-shared'

/**
 * Phase 11.4 / multi-appearance — per-episode appearance binding.
 *
 * EpisodeCharacter.appearanceId tells the panel-image worker which
 * CharacterAppearance to use when this character shows up in panels of
 * THIS episode. null = fall back to appearance[0]. Lets users say
 * "ep1-10 use appearance A, ep11+ use appearance B" without rewriting
 * every panel character ref.
 */

interface EpisodeBindingRow {
  characterId: string
  appearanceId: string | null
}

export function useEpisodeCharacterBindings(
  projectId: string,
  episodeId: string | null | undefined,
) {
  return useQuery({
    queryKey: episodeId
      ? ([...queryKeys.tasks.all(projectId), 'episode-bindings', episodeId] as const)
      : (['episode-bindings', 'no-episode'] as const),
    enabled: !!episodeId,
    staleTime: 10_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/novel-promotion/${projectId}/episodes/${episodeId}/character-appearance`,
      )
      if (!res.ok) throw new Error('Failed to fetch episode-character bindings')
      const data = (await res.json()) as { bindings?: EpisodeBindingRow[] }
      return data.bindings || []
    },
  })
}

interface EpisodeLocationBindingRow {
  locationId: string
  role: string | null
}

interface EpisodePropBindingRow {
  propId: string
  role: string | null
}

/**
 * Read-side hook: which locations are bound to a given episode via
 * EpisodeLocation. Mirrors useEpisodeCharacterBindings so V2 SubjectsPage
 * can filter the 場景 grid the same way it filters the 角色 grid.
 */
export function useEpisodeLocationBindings(
  projectId: string,
  episodeId: string | null | undefined,
) {
  return useQuery({
    queryKey: episodeId
      ? ([...queryKeys.tasks.all(projectId), 'episode-location-bindings', episodeId] as const)
      : (['episode-location-bindings', 'no-episode'] as const),
    enabled: !!episodeId,
    staleTime: 10_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/novel-promotion/${projectId}/episodes/${episodeId}/locations`,
      )
      if (!res.ok) throw new Error('Failed to fetch episode-location bindings')
      const data = (await res.json()) as { bindings?: EpisodeLocationBindingRow[] }
      return data.bindings || []
    },
  })
}

export function useEpisodePropBindings(
  projectId: string,
  episodeId: string | null | undefined,
) {
  return useQuery({
    queryKey: episodeId
      ? ([...queryKeys.tasks.all(projectId), 'episode-prop-bindings', episodeId] as const)
      : (['episode-prop-bindings', 'no-episode'] as const),
    enabled: !!episodeId,
    staleTime: 10_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/novel-promotion/${projectId}/episodes/${episodeId}/props`,
      )
      if (!res.ok) throw new Error('Failed to fetch episode-prop bindings')
      const data = (await res.json()) as { bindings?: EpisodePropBindingRow[] }
      return data.bindings || []
    },
  })
}

/**
 * Phase 11.4 — create a new CharacterAppearance row for an existing
 * character. Passing episodeId atomically binds the new appearance to that
 * episode; omitting it creates a catalog-only appearance.
 *
 * After creation the user typically follows up with:
 *   1) /character/appearance PATCH to fill the visual_description prompt
 *   2) regenerate-single-image to actually generate the new outfit's
 *      reference sheet
 *   3) use the bulk binding mutation only when extending the appearance to
 *      an additional episode range.
 */
export function useCreateCharacterAppearance(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      characterId: string
      changeReason: string
      description: string
      episodeId?: string
    }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/character/appearance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
        'Failed to create new appearance',
      )
    },
    onSuccess: async (_data, params) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectAssets.all(projectId),
        exact: true,
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectAssets.characters(projectId),
        exact: true,
      })
      if (params.episodeId) {
        await queryClient.invalidateQueries({
          queryKey: [
            ...queryKeys.tasks.all(projectId),
            'episode-bindings',
            params.episodeId,
          ],
          exact: true,
        })
      }
    },
  })
}

export function useUpdateEpisodeCharacterBinding(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      episodeId: string
      characterId: string
      appearanceId: string | null
    }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/episodes/${params.episodeId}/character-appearance`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterId: params.characterId,
            appearanceId: params.appearanceId,
          }),
        },
        'Failed to update episode-character binding',
      )
    },
    onSuccess: (_data, vars) => {
      // Invalidate the per-episode bindings cache so the dropdown
      // re-renders with the saved appearanceId. Also invalidate
      // projectAssets in case any downstream view re-renders.
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.tasks.all(projectId), 'episode-bindings', vars.episodeId],
      })
      invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
    },
  })
}

/**
 * Bulk variant — bind one appearance (or null = clear) to a SET of
 * episodes for one character in a single transactional call. Used by
 * the "套用至 ep1-10" range affordance on V2CharacterAppearancesPanel
 * so users don't have to click N dropdowns when a costume change is
 * episode-range based.
 */
export function useBulkBindEpisodeCharacterAppearance(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      characterId: string
      appearanceId: string | null
      episodeIds: string[]
    }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/character/bind-appearance-bulk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
        'Failed to bulk-bind episode-character appearances',
      )
    },
    onSuccess: (_data, vars) => {
      // Invalidate every affected episode's binding cache. Cheaper than
      // a project-wide nuke and keeps unrelated episodes' data in cache.
      for (const episodeId of vars.episodeIds) {
        void queryClient.invalidateQueries({
          queryKey: [...queryKeys.tasks.all(projectId), 'episode-bindings', episodeId],
        })
      }
      invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
    },
  })
}

/**
 * Delete a single CharacterAppearance row. The DELETE endpoint refuses
 * to remove the last appearance (one-per-character minimum), so the
 * caller doesn't need to gate the call — surface the server's error
 * message verbatim if it comes back as INVALID_PARAMS.
 */
export function useDeleteCharacterAppearance(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { characterId: string; appearanceId: string }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/character/appearance?` +
          new URLSearchParams({
            characterId: params.characterId,
            appearanceId: params.appearanceId,
          }).toString(),
        { method: 'DELETE' },
        'Failed to delete character appearance',
      )
    },
    onSuccess: () => {
      invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
    },
  })
}

/**
 * Update an appearance's name (changeReason) and/or description.
 * Either field can be omitted to leave it untouched; passing both
 * empty strings throws server-side. Used by the inline rename flow on
 * the appearance row.
 */
export function useUpdateCharacterAppearanceMeta(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      characterId: string
      appearanceId: string
      changeReason?: string
      description?: string
    }) => {
      return await requestJsonWithError(
        `/api/novel-promotion/${projectId}/character/appearance`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
        'Failed to update character appearance',
      )
    },
    onSuccess: () => {
      invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
    },
  })
}
