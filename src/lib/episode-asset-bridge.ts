/**
 * Phase 11.2: Episode <-> Project asset (character/location) bridge
 *
 * Junction tables `EpisodeCharacter` / `EpisodeLocation` are the single source of
 * truth for "which characters/locations appear in which episode". The legacy
 * `panels.characters` / `panels.location` text fields remain as panel-level
 * rendering attributes but must NOT be back-queried for episode-level lookups.
 *
 * Match strategy (Q-2 B), three-layer fallback (NO fuzzy matching):
 *   1. exact name match (case-sensitive)
 *   2. name match (case-insensitive)
 *   3. aliases JSON contains the name (case-sensitive then case-insensitive)
 *
 * Origin tracking (Q-3 C) via `role`:
 *   - 'auto-from-panel'        — written by storyboard helpers from panel data
 *   - 'manual'                 — manually attached by user via UI
 *   - 'imported-from-global'   — copied in from the global asset hub
 */

import { Prisma } from '@prisma/client'
import type { NovelPromotionEpisode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logWarn } from '@/lib/logging/core'

type TxOrPrisma = Prisma.TransactionClient | typeof prisma

export type EpisodeAssetRole = 'auto-from-panel' | 'manual' | 'imported-from-global'

export interface CharacterMatchInput {
  projectId: string
  episodeId: string
  panelCharacterNames: string[]
  role: EpisodeAssetRole
}

export interface LocationMatchInput {
  projectId: string
  episodeId: string
  locationName: string | null
  role: EpisodeAssetRole
}

export interface CharacterMatchResult {
  matched: number
  unmatched: string[]
  ambiguous: string[]
}

export interface LocationMatchResult {
  matched: boolean
  unmatched: boolean
  ambiguous: boolean
}

interface CharacterCandidate {
  id: string
  name: string
  aliases: string | null
}

interface LocationCandidate {
  id: string
  name: string
}

/**
 * Parse aliases JSON column. Stored as a JSON-encoded string array (e.g. `["小明","明明"]`).
 * Returns empty array on any parse failure.
 */
function parseAliases(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

/**
 * Q-2 B three-layer name match (NO fuzzy):
 *   1. exact (case-sensitive) name
 *   2. case-insensitive name
 *   3. aliases JSON contains name (case-sensitive then case-insensitive)
 *
 * Returns the list of matched candidate ids. Empty = unmatched, len > 1 = ambiguous.
 */
function matchByName<T extends { id: string; name: string; aliases?: string | null }>(
  needle: string,
  candidates: T[],
): T[] {
  const trimmed = needle.trim()
  if (!trimmed) return []

  // Layer 1: exact name (case-sensitive)
  const exact = candidates.filter((c) => c.name === trimmed)
  if (exact.length > 0) return exact

  // Layer 2: case-insensitive name
  const lowered = trimmed.toLowerCase()
  const insensitive = candidates.filter((c) => c.name.toLowerCase() === lowered)
  if (insensitive.length > 0) return insensitive

  // Layer 3a: aliases contain name (case-sensitive)
  const aliasExact = candidates.filter((c) => parseAliases(c.aliases ?? null).includes(trimmed))
  if (aliasExact.length > 0) return aliasExact

  // Layer 3b: aliases contain name (case-insensitive)
  const aliasInsensitive = candidates.filter((c) =>
    parseAliases(c.aliases ?? null).some((alias) => alias.toLowerCase() === lowered),
  )
  return aliasInsensitive
}

/**
 * Match panel character names against project-level NovelPromotionCharacter and
 * write missing junction rows. Idempotent via `@@unique([episodeId, characterId])`.
 *
 * - 0 matches  → log warn + push to unmatched, skip
 * - >1 matches → log warn + push to ambiguous, skip (no fuzzy guesses)
 * - 1 match    → enqueue (episodeId, characterId, role) for batch insert
 *
 * Strategy: pre-load existing junction pairs, then `createMany skipDuplicates`
 * for new pairs only (createMany does not support upsert; we don't need to
 * overwrite existing role values per Q-3 C — first writer wins).
 */
export async function linkEpisodeCharactersFromPanel(
  tx: TxOrPrisma,
  input: CharacterMatchInput,
): Promise<CharacterMatchResult> {
  const { projectId, episodeId, panelCharacterNames, role } = input
  const unmatched: string[] = []
  const ambiguous: string[] = []

  if (panelCharacterNames.length === 0) {
    return { matched: 0, unmatched, ambiguous }
  }

  // Get the NovelPromotionProject row id (panel scope) by walking project relation.
  // The schema uses `novelPromotionProjectId` on NovelPromotionCharacter, so we must
  // resolve the NovelPromotionProject id from the upstream Project id.
  const novelProject = await tx.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    logWarn('[episode-asset-bridge] linkEpisodeCharactersFromPanel: NovelPromotionProject not found', {
      projectId,
      episodeId,
    })
    return { matched: 0, unmatched: panelCharacterNames.slice(), ambiguous }
  }

  const candidates: CharacterCandidate[] = await tx.novelPromotionCharacter.findMany({
    where: { novelPromotionProjectId: novelProject.id },
    select: { id: true, name: true, aliases: true },
  })

  const matchedCharacterIds = new Set<string>()
  for (const rawName of panelCharacterNames) {
    if (!rawName || typeof rawName !== 'string') continue
    const matches = matchByName(rawName, candidates)
    if (matches.length === 0) {
      unmatched.push(rawName)
      logWarn('[episode-asset-bridge] character name unmatched (skipping, NOT auto-creating)', {
        episodeId,
        projectId,
        name: rawName,
      })
      continue
    }
    if (matches.length > 1) {
      ambiguous.push(rawName)
      logWarn('[episode-asset-bridge] character name ambiguous (skipping)', {
        episodeId,
        projectId,
        name: rawName,
        candidateIds: matches.map((m) => m.id),
      })
      continue
    }
    matchedCharacterIds.add(matches[0].id)
  }

  if (matchedCharacterIds.size === 0) {
    return { matched: 0, unmatched, ambiguous }
  }

  // Pre-filter existing pairs so we only insert new ones (idempotent).
  const existing = await tx.episodeCharacter.findMany({
    where: { episodeId, characterId: { in: Array.from(matchedCharacterIds) } },
    select: { characterId: true },
  })
  const existingSet = new Set(existing.map((e) => e.characterId))

  const toInsert = Array.from(matchedCharacterIds)
    .filter((id) => !existingSet.has(id))
    .map((characterId) => ({ episodeId, characterId, role }))

  if (toInsert.length === 0) {
    return { matched: matchedCharacterIds.size, unmatched, ambiguous }
  }

  await tx.episodeCharacter.createMany({
    data: toInsert,
    skipDuplicates: true,
  })

  return { matched: matchedCharacterIds.size, unmatched, ambiguous }
}

/**
 * Same shape as linkEpisodeCharactersFromPanel but for a single location string.
 * Locations have no aliases column — match strategy is reduced to layers 1 + 2.
 */
export async function linkEpisodeLocationFromPanel(
  tx: TxOrPrisma,
  input: LocationMatchInput,
): Promise<LocationMatchResult> {
  const { projectId, episodeId, locationName, role } = input

  if (!locationName || typeof locationName !== 'string' || locationName.trim() === '') {
    return { matched: false, unmatched: false, ambiguous: false }
  }

  const novelProject = await tx.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    logWarn('[episode-asset-bridge] linkEpisodeLocationFromPanel: NovelPromotionProject not found', {
      projectId,
      episodeId,
    })
    return { matched: false, unmatched: true, ambiguous: false }
  }

  const candidates: LocationCandidate[] = await tx.novelPromotionLocation.findMany({
    where: { novelPromotionProjectId: novelProject.id },
    select: { id: true, name: true },
  })

  // Reuse matchByName with empty aliases; layer 3 is a no-op for locations.
  const matches = matchByName(
    locationName,
    candidates.map((c) => ({ ...c, aliases: null })),
  )

  if (matches.length === 0) {
    logWarn('[episode-asset-bridge] location name unmatched (skipping, NOT auto-creating)', {
      episodeId,
      projectId,
      name: locationName,
    })
    return { matched: false, unmatched: true, ambiguous: false }
  }
  if (matches.length > 1) {
    logWarn('[episode-asset-bridge] location name ambiguous (skipping)', {
      episodeId,
      projectId,
      name: locationName,
      candidateIds: matches.map((m) => m.id),
    })
    return { matched: false, unmatched: false, ambiguous: true }
  }

  const locationId = matches[0].id

  const existing = await tx.episodeLocation.findUnique({
    where: { episodeId_locationId: { episodeId, locationId } },
    select: { id: true },
  })
  if (existing) {
    return { matched: true, unmatched: false, ambiguous: false }
  }

  await tx.episodeLocation.create({
    data: { episodeId, locationId, role },
  })

  return { matched: true, unmatched: false, ambiguous: false }
}

/** Lookup which episodes a given character appears in (via junction). */
export async function getEpisodesForCharacter(
  characterId: string,
): Promise<Pick<NovelPromotionEpisode, 'id' | 'episodeNumber' | 'name'>[]> {
  const rows = await prisma.episodeCharacter.findMany({
    where: { characterId },
    include: {
      episode: { select: { id: true, episodeNumber: true, name: true } },
    },
    orderBy: { episode: { episodeNumber: 'asc' } },
  })
  return rows.map((r) => r.episode)
}

/** Lookup which episodes a given location appears in (via junction). */
export async function getEpisodesForLocation(
  locationId: string,
): Promise<Pick<NovelPromotionEpisode, 'id' | 'episodeNumber' | 'name'>[]> {
  const rows = await prisma.episodeLocation.findMany({
    where: { locationId },
    include: {
      episode: { select: { id: true, episodeNumber: true, name: true } },
    },
    orderBy: { episode: { episodeNumber: 'asc' } },
  })
  return rows.map((r) => r.episode)
}

// Re-export the matcher so callers (e.g. backfill script) can reuse exactly the
// same Q-2 B logic without duplicating it.
export const _internal = {
  matchByName,
  parseAliases,
}
