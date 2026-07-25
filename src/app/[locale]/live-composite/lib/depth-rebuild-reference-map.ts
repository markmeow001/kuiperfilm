import type {
  DepthRebuildCharacterReference,
  DepthRebuildSceneReference,
  LocalDepthReferenceImage,
} from '../depth-rebuild-assets'

export type DepthRebuildReferenceKind = 'character' | 'scene'

export interface OrderedDepthRebuildReference {
  id: string
  ownerId: string
  kind: DepthRebuildReferenceKind
  token: string
  name: string
  image: LocalDepthReferenceImage
}

export interface DepthRebuildReferenceMap {
  ordered: readonly OrderedDepthRebuildReference[]
  tokensByCharacterId: ReadonlyMap<string, string>
  sceneTokens: readonly string[]
}

function compactLabel(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return (normalized || fallback).slice(0, 60)
}

/**
 * Seedance R2V only binds plain references by ordered `image N` text.
 * This helper is the single source of truth for UI preview, prompt mapping,
 * upload order and referenceImageNames.
 */
export function buildDepthRebuildReferenceMap(
  characters: readonly DepthRebuildCharacterReference[],
  scenes: readonly DepthRebuildSceneReference[],
): DepthRebuildReferenceMap {
  const ordered: OrderedDepthRebuildReference[] = []
  const tokensByCharacterId = new Map<string, string>()
  const sceneTokens: string[] = []

  for (const [index, character] of characters.entries()) {
    if (!character.image) continue
    const token = `image ${ordered.length + 1}`
    const label = compactLabel(character.label, `新角色 ${index + 1}`)
    ordered.push({
      id: `character:${character.id}`,
      ownerId: character.id,
      kind: 'character',
      token,
      name: `角色：${label}`,
      image: character.image,
    })
    tokensByCharacterId.set(character.id, token)
  }

  for (const [index, scene] of scenes.entries()) {
    const token = `image ${ordered.length + 1}`
    ordered.push({
      id: `scene:${scene.id}`,
      ownerId: scene.id,
      kind: 'scene',
      token,
      name: `場景參考 ${index + 1}`,
      image: scene.image,
    })
    sceneTokens.push(token)
  }

  return { ordered, tokensByCharacterId, sceneTokens }
}
