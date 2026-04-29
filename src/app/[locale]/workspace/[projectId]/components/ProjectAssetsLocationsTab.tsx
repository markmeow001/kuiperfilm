'use client'

import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'

interface EpisodeAppearance {
  id: string
  episodeNumber: number
  name: string
  role: string | null
}

interface LocationRow {
  id: string
  name: string
  episodes: EpisodeAppearance[]
  images?: Array<{
    id: string
    imageIndex: number
    imageUrl: string | null
  }>
}

interface LocationsResponse {
  success: boolean
  data: { locations: LocationRow[] }
}

interface Props {
  projectId: string
  onImportClick: () => void
}

/**
 * Phase 11.2 — locations tab inside ProjectAssets.
 * Loads project locations via GET /api/projects/[projectId]/locations
 * and shows the cross-episode appearance summary from the EpisodeLocation junction.
 */
export default function ProjectAssetsLocationsTab({ projectId, onImportClick }: Props) {
  const t = useTranslations('workspaceDetail.projectAssets')

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-locations', projectId],
    queryFn: async (): Promise<LocationRow[]> => {
      const res = await fetch(`/api/projects/${projectId}/locations`)
      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        throw new Error(errBody?.error || 'Failed to load locations')
      }
      const body = (await res.json()) as LocationsResponse
      return body.data?.locations ?? []
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

  const locations = data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--glass-text-secondary)]">
          {t('locationsCount', { count: locations.length })}
        </span>
        <button
          type="button"
          onClick={onImportClick}
          className="glass-btn-base glass-btn-primary px-4 py-2 text-sm"
        >
          {t('importFromGlobal')}
        </button>
      </div>

      {locations.length === 0 ? (
        <div className="glass-surface p-8 text-center text-[var(--glass-text-secondary)]">
          {t('emptyLocations')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map((l) => {
            const cover = l.images?.find((img) => img.imageUrl)?.imageUrl ?? null
            return (
              <div key={l.id} className="glass-surface p-4 space-y-3">
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
                      {l.name}
                    </div>
                    <div className="text-xs text-[var(--glass-text-secondary)]">
                      {l.episodes.length === 0
                        ? t('appearsInNone')
                        : t('appearsInEpisodes', {
                          list: l.episodes
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
