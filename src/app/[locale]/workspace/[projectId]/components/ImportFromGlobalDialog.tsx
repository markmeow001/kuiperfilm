'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'

interface GlobalCharacterRow {
  id: string
  name: string
  appearances?: Array<{ imageUrl: string | null }>
}

interface GlobalLocationRow {
  id: string
  name: string
  images?: Array<{ imageUrl: string | null }>
}

type AssetKind = 'character' | 'location'

interface Props {
  projectId: string
  kind: AssetKind
  onClose: () => void
}

/**
 * Phase 11.2 — modal that lists the user's GlobalCharacter / GlobalLocation
 * and posts to the project's import-character / import-location route on click.
 */
export default function ImportFromGlobalDialog({ projectId, kind, onClose }: Props) {
  const t = useTranslations('workspaceDetail.projectAssets')
  const queryClient = useQueryClient()
  const [includeChildren, setIncludeChildren] = useState<boolean>(true)

  const listQueryKey = kind === 'character'
    ? ['asset-hub-characters']
    : ['asset-hub-locations']

  const { data, isLoading, error } = useQuery({
    queryKey: listQueryKey,
    queryFn: async () => {
      const url = kind === 'character' ? '/api/asset-hub/characters' : '/api/asset-hub/locations'
      const res = await fetch(url)
      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        throw new Error(errBody?.error || 'Failed to load global assets')
      }
      const body = await res.json()
      if (kind === 'character') {
        return (body.characters ?? []) as GlobalCharacterRow[]
      }
      return (body.locations ?? []) as GlobalLocationRow[]
    },
  })

  const importMutation = useMutation({
    mutationFn: async (globalId: string) => {
      const url = kind === 'character'
        ? `/api/projects/${projectId}/import-character`
        : `/api/projects/${projectId}/import-location`
      const body = kind === 'character'
        ? { globalCharacterId: globalId, includeAppearances: includeChildren }
        : { globalLocationId: globalId, includeImages: includeChildren }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        throw new Error(errBody?.error || 'Import failed')
      }
      return res.json()
    },
    onSuccess: () => {
      // Invalidate the per-project asset queries so the parent list refreshes.
      queryClient.invalidateQueries({
        queryKey: kind === 'character'
          ? ['project-characters', projectId]
          : ['project-locations', projectId],
      })
      onClose()
    },
  })

  const items = data ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-surface max-w-2xl w-full max-h-[80vh] flex flex-col p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">
            {kind === 'character' ? t('importCharacterTitle') : t('importLocationTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]"
            aria-label={t('close')}
          >
            ×
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--glass-text-secondary)] mb-3">
          <input
            type="checkbox"
            checked={includeChildren}
            onChange={(e) => setIncludeChildren(e.target.checked)}
          />
          {kind === 'character' ? t('includeAppearances') : t('includeImages')}
        </label>

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {isLoading ? (
            <div className="text-center text-[var(--glass-text-secondary)] py-8">
              {t('loading')}
            </div>
          ) : error ? (
            <div className="text-center text-[var(--glass-tone-danger-fg)] py-8">
              {error instanceof Error ? error.message : t('loadFailed')}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-[var(--glass-text-secondary)] py-8">
              {t('emptyGlobalList')}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const cover = kind === 'character'
                  ? (item as GlobalCharacterRow).appearances?.find((a) => a.imageUrl)?.imageUrl
                  : (item as GlobalLocationRow).images?.find((i) => i.imageUrl)?.imageUrl
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => importMutation.mutate(item.id)}
                    disabled={importMutation.isPending}
                    className="w-full flex items-center gap-3 p-3 rounded-lg bg-[var(--glass-bg-muted)] hover:bg-[var(--glass-bg-elevated)] transition-colors text-left disabled:opacity-50"
                  >
                    {cover ? (
                      <div
                        className="w-12 h-12 rounded bg-cover bg-center bg-[var(--glass-bg-elevated)]"
                        style={{ backgroundImage: `url(${cover})` }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-[var(--glass-bg-elevated)]" />
                    )}
                    <span className="font-medium text-[var(--glass-text-primary)]">
                      {item.name}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {importMutation.isError ? (
          <div className="mt-3 text-sm text-[var(--glass-tone-danger-fg)]">
            {importMutation.error instanceof Error
              ? importMutation.error.message
              : t('importFailed')}
          </div>
        ) : null}
      </div>
    </div>
  )
}
