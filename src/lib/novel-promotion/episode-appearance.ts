import { prisma } from '@/lib/prisma'
import type {
  CharacterAppearanceLike,
  CharacterLike,
  NovelProjectData,
} from '@/lib/workers/handlers/image-task-handler-shared'

export type EpisodeAppearanceResolutionErrorCode =
  | 'EPISODE_APPEARANCE_BINDINGS_LOAD_FAILED'
  | 'EPISODE_APPEARANCE_EPISODE_SCOPE_MISMATCH'
  | 'EPISODE_APPEARANCE_CHARACTER_NOT_FOUND'
  | 'EPISODE_APPEARANCE_BINDING_MISSING'
  | 'EPISODE_APPEARANCE_BINDING_STALE'
  | 'EPISODE_APPEARANCE_NOT_FOUND'

export class EpisodeAppearanceResolutionError extends Error {
  constructor(
    readonly code: EpisodeAppearanceResolutionErrorCode,
    readonly characterId: string | null = null,
    options?: ErrorOptions,
  ) {
    super(characterId ? `${code}:${characterId}` : code, options)
    this.name = 'EpisodeAppearanceResolutionError'
  }
}

export interface EpisodeAppearancePanel {
  characters?: string | null
  description?: string | null
  videoPrompt?: string | null
  srtSegment?: string | null
}

export interface EpisodeAppearanceCharacterOverride {
  characterId: string
  appearanceId?: string
}

export interface CanonicalizeEpisodeCharacterAppearancesInput {
  projectId: string
  episodeId: string
  projectData: NovelProjectData
  panels: readonly EpisodeAppearancePanel[]
  extraMiningText?: string | null
  characterOverrides?: readonly EpisodeAppearanceCharacterOverride[]
}

function aliases(name: string): string[] {
  return name
    .toLowerCase()
    .split('/')
    .map((value) => value.trim())
    .filter(Boolean)
}

function findCharacterByReference(
  characters: readonly CharacterLike[],
  referenceName: string,
): CharacterLike | null {
  const referenceAliases = aliases(referenceName)
  if (referenceAliases.length === 0) return null
  return characters.find((character) => {
    const characterAliases = aliases(character.name)
    return referenceAliases.some((alias) => characterAliases.includes(alias))
  }) ?? null
}

function parsePanelCharacterNames(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (typeof item === 'string') return item.trim() ? [item.trim()] : []
      if (!item || typeof item !== 'object') return []
      const name = (item as { name?: unknown }).name
      return typeof name === 'string' && name.trim() ? [name.trim()] : []
    })
  } catch {
    return []
  }
}

function pickDeterministicDefault(
  appearances: readonly CharacterAppearanceLike[],
): CharacterAppearanceLike | null {
  return appearances.reduce<CharacterAppearanceLike | null>((lowest, candidate) => {
    if (!lowest) return candidate
    const candidateIndex = candidate.appearanceIndex ?? Number.MAX_SAFE_INTEGER
    const lowestIndex = lowest.appearanceIndex ?? Number.MAX_SAFE_INTEGER
    if (candidateIndex < lowestIndex) return candidate
    if (candidateIndex > lowestIndex) return lowest
    return candidate.id.localeCompare(lowest.id) < 0 ? candidate : lowest
  }, null)
}

function collectReferencedCharacterIds(
  input: CanonicalizeEpisodeCharacterAppearancesInput,
): Set<string> {
  const characters = input.projectData.characters ?? []
  const referencedIds = new Set<string>()

  for (const panel of input.panels) {
    for (const name of parsePanelCharacterNames(panel.characters)) {
      const character = findCharacterByReference(characters, name)
      if (character) referencedIds.add(character.id)
    }
  }

  const searchableText = [
    ...input.panels.flatMap((panel) => [
      panel.description,
      panel.videoPrompt,
      panel.srtSegment,
    ]),
    input.extraMiningText,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
    .replace(/@/g, '')
    .toLowerCase()

  if (searchableText) {
    for (const character of characters) {
      if (aliases(character.name).some((alias) => searchableText.includes(alias))) {
        referencedIds.add(character.id)
      }
    }
  }

  for (const override of input.characterOverrides ?? []) {
    const character = characters.find((candidate) => candidate.id === override.characterId)
    if (!character) {
      throw new EpisodeAppearanceResolutionError(
        'EPISODE_APPEARANCE_CHARACTER_NOT_FOUND',
        override.characterId,
      )
    }
    // appearanceId is deliberately ignored. An episode binding is the only
    // authority for appearance selection; the override only force-includes
    // a character that the caller wants anchored in this generation.
    referencedIds.add(character.id)
  }

  return referencedIds
}

/**
 * Collapse the worker's character catalog to the one appearance authorised
 * by the selected episode. The returned catalog contains only characters
 * referenced by the generation input, each with exactly one appearance.
 * Legacy panel hints and per-call overrides therefore cannot select a
 * different costume after this boundary.
 */
export async function canonicalizeEpisodeCharacterAppearances(
  input: CanonicalizeEpisodeCharacterAppearancesInput,
): Promise<NovelProjectData> {
  let episode: {
    id: string
    episodeCharacters: Array<{ characterId: string; appearanceId: string | null }>
  } | null

  try {
    episode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: input.episodeId,
        novelPromotionProject: { projectId: input.projectId },
      },
      select: {
        id: true,
        episodeCharacters: {
          select: { characterId: true, appearanceId: true },
        },
      },
    })
  } catch (cause) {
    throw new EpisodeAppearanceResolutionError(
      'EPISODE_APPEARANCE_BINDINGS_LOAD_FAILED',
      null,
      { cause },
    )
  }

  if (!episode) {
    throw new EpisodeAppearanceResolutionError(
      'EPISODE_APPEARANCE_EPISODE_SCOPE_MISMATCH',
    )
  }

  const referencedIds = collectReferencedCharacterIds(input)
  const bindingByCharacterId = new Map(
    episode.episodeCharacters.map((binding) => [binding.characterId, binding.appearanceId]),
  )
  const canonicalCharacters: CharacterLike[] = []

  for (const character of input.projectData.characters ?? []) {
    if (!referencedIds.has(character.id)) continue
    if (!bindingByCharacterId.has(character.id)) {
      throw new EpisodeAppearanceResolutionError(
        'EPISODE_APPEARANCE_BINDING_MISSING',
        character.id,
      )
    }

    const appearances = character.appearances ?? []
    const boundAppearanceId = bindingByCharacterId.get(character.id)
    const appearance = boundAppearanceId === null
      ? pickDeterministicDefault(appearances)
      : appearances.find((candidate) => candidate.id === boundAppearanceId) ?? null

    if (boundAppearanceId !== null && !appearance) {
      throw new EpisodeAppearanceResolutionError(
        'EPISODE_APPEARANCE_BINDING_STALE',
        character.id,
      )
    }
    if (!appearance) {
      throw new EpisodeAppearanceResolutionError(
        'EPISODE_APPEARANCE_NOT_FOUND',
        character.id,
      )
    }

    canonicalCharacters.push({
      ...character,
      appearances: [appearance],
    })
  }

  return {
    ...input.projectData,
    characters: canonicalCharacters,
  }
}
