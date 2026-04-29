'use client'

import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'

interface EpisodeAppearance {
  id: string
  episodeNumber: number
  name: string
  role: string | null
}

interface CharacterRow {
  id: string
  name: string
  episodes: EpisodeAppearance[]
  appearances?: Array<{
    id: string
    appearanceIndex: number
    imageUrl: string | null
  }>
}

interface CharactersResponse {
  success: boolean
  data: { characters: CharacterRow[] }
}

interface Props {
  projectId: string
  onImportClick: () => void
}

/**
 * Phase 11.2 — characters tab inside ProjectAssets.
 * Loads project characters via GET /api/projects/[projectId]/characters
 * and shows the cross-episode appearance summary from the EpisodeCharacter junction.
 */
export default function ProjectAssetsCharactersTab({ projectId, onImportClick }: Props) {
  const t = useTranslations('workspaceDetail.projectAssets')

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-characters', projectId],
    queryFn: async (): Promise<CharacterRow[]> => {
      const res = await fetch(`/api/projects/${projectId}/characters`)
      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        throw new Error(errBody?.error || 'Failed to load characters')
      }
      const body = (await res.json()) as CharactersResponse
      return body.data?.characters ?? []
    },
    staleTime: 5_000,
  })

  if (isLoading) {
    return (
      <div className="text-center text-[var(--glass-text-secondary)] py-8">
        {t('loading')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center text-[var(--glass-tone-danger-fg)] py-8">
        {error instanceof Error ? error.message : t('loadFailed')}
      </div>
    )
  }

  const characters = data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--glass-text-secondary)]">
          {t('charactersCount', { count: characters.length })}
        </span>
        <button
          type="button"
          onClick={onImportClick}
          className="glass-btn-base glass-btn-primary px-4 py-2 text-sm"
        >
          {t('importFromGlobal')}
        </button>
      </div>

      {characters.length === 0 ? (
        <div className="glass-surface p-8 text-center text-[var(--glass-text-secondary)]">
          {t('emptyCharacters')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {characters.map((c) => {
            const cover = c.appearances?.find((a) => a.imageUrl)?.imageUrl ?? null
            return (
              <div key={c.id} className="glass-surface p-4 space-y-3">
                <div className="flex items-center gap-3">
                  {cover ? (
                    <div
                      className="w-14 h-14 rounded-lg bg-cover bg-center bg-[var(--glass-bg-muted)]"
                      style={{ backgroundImage: `url(${cover})` }}
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-[var(--glass-bg-muted)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[var(--glass-text-primary)] truncate">
                      {c.name}
                    </div>
                    <div className="text-xs text-[var(--glass-text-secondary)]">
                      {c.episodes.length === 0
                        ? t('appearsInNone')
                        : t('appearsInEpisodes', {
                          list: c.episodes
                            .map((ep) => `Ep${ep.episodeNumber}`)
                            .join(', '),
                        })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
