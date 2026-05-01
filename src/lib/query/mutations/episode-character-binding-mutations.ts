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

/**
 * Phase 11.4 — create a new CharacterAppearance row for an existing
 * character. Adds a 「造型 N+1」 the user can then bind per-episode via
 * useUpdateEpisodeCharacterBinding above.
 *
 * After creation the user typically follows up with:
 *   1) /character/appearance PATCH to fill the visual_description prompt
 *   2) regenerate-single-image to actually generate the new outfit's
 *      reference sheet
 *   3) episode-character-binding PATCH to assign the new appearance to
 *      the correct episode range.
 */
export function useCreateCharacterAppearance(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      characterId: string
      changeReason: string
      description: string
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
    onSuccess: () => {
      invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
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
