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
