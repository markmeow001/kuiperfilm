'use client'

/**
 * 角色库 — the user's global character library (CharacterAppearance), surfaced
 * into the canvas so a saved character can be dropped as a Character node
 * (binding its appearance image as the reference fed downstream).
 *
 * Reads /api/asset-hub/characters (global, per-user). Each character may have
 * several appearances; we flatten to one card per appearance with its image.
 */
import { useQuery } from '@tanstack/react-query'
import { requestJsonWithError } from '@/lib/query/mutations/mutation-shared'

export interface CharacterLibraryItem {
  characterId: string
  appearanceId: string
  name: string
  imageUrl: string | null
}

interface RawAppearance {
  id?: string
  name?: string
  imageUrl?: string | null
}
interface RawCharacter {
  id?: string
  name?: string
  appearances?: RawAppearance[]
}

export function useCharacterLibrary(enabled: boolean) {
  return useQuery({
    queryKey: ['canvasCharacterLibrary'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<CharacterLibraryItem[]> => {
      const data = (await requestJsonWithError(
        '/api/asset-hub/characters',
        { method: 'GET' },
        '加载角色库失败',
      )) as { characters?: RawCharacter[] }
      const items: CharacterLibraryItem[] = []
      for (const c of data.characters ?? []) {
        const apps = Array.isArray(c.appearances) && c.appearances.length > 0 ? c.appearances : [{ id: c.id, name: c.name, imageUrl: null }]
        for (const a of apps) {
          if (!a.imageUrl) continue // only show appearances with an image
          items.push({
            characterId: String(c.id ?? ''),
            appearanceId: String(a.id ?? c.id ?? ''),
            name: a.name && a.name !== c.name ? `${c.name ?? '角色'}·${a.name}` : c.name ?? '角色',
            imageUrl: a.imageUrl,
          })
        }
      }
      return items
    },
  })
}
