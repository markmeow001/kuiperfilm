/**
 * Phase 11.4 / multi-appearance — picks the correct CharacterAppearance
 * row for a (character, episode) pair, honouring the per-episode
 * binding in EpisodeCharacter.appearanceId.
 *
 * Resolution order:
 *   1. EpisodeCharacter.appearanceId (admin set "ep1-10 = appearance A")
 *   2. The caller-supplied changeReason match (legacy path —
 *      e.g. panel description tags character with `(改造後)`)
 *   3. appearances[0] (legacy default)
 *
 * This file is currently consumed only by Stage 4 wiring — older
 * workers continue using the legacy logic unchanged. New / migrated
 * workers should call resolveAppearanceForEpisode so a project that
 * defines per-episode bindings is respected.
 */

import { prisma } from '@/lib/prisma'

export interface AppearanceLite {
  id: string
  appearanceIndex: number
  changeReason?: string | null
  description?: string | null
  imageUrl?: string | null
  imageUrls?: string | null
}

interface CharacterLite {
  id: string
  appearances?: AppearanceLite[] | null
}

/**
 * Resolve which CharacterAppearance to use for a character appearing in
 * a specific episode. Pure function over already-loaded data — does
 * not hit prisma. Use loadEpisodeAppearanceMap below to fetch the
 * (character, appearance) bindings before calling this.
 */
export function pickAppearanceForCharacter(
  character: CharacterLite,
  episodeBindings: ReadonlyMap<string, string>, // characterId → appearanceId
  legacyHint?: { changeReasonHint?: string | null },
): AppearanceLite | null {
  const appearances = character.appearances ?? []
  if (appearances.length === 0) return null

  const boundId = episodeBindings.get(character.id)
  if (boundId) {
    const found = appearances.find((a) => a.id === boundId)
    if (found) return found
  }

  if (legacyHint?.changeReasonHint) {
    const hint = legacyHint.changeReasonHint.toLowerCase()
    const matched = appearances.find(
      (a) => (a.changeReason ?? '').toLowerCase() === hint,
    )
    if (matched) return matched
  }

  return appearances[0] ?? null
}

/**
 * Loads the per-episode (character → appearance) binding map for one
 * episode. Returns characterIds whose appearance is fixed; characters
 * without a row here fall back to appearances[0].
 */
export async function loadEpisodeAppearanceMap(
  episodeId: string,
): Promise<Map<string, string>> {
  if (!episodeId) return new Map()
  const rows = await prisma.episodeCharacter.findMany({
    where: { episodeId, appearanceId: { not: null } },
    select: { characterId: true, appearanceId: true },
  })
  const map = new Map<string, string>()
  for (const r of rows) {
    if (r.appearanceId) map.set(r.characterId, r.appearanceId)
  }
  return map
}
