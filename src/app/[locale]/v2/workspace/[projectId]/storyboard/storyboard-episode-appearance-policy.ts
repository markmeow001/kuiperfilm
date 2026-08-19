import {
  resolveActiveCharacterAppearance,
  type ActiveCharacterAppearanceBindingState,
  type ActiveCharacterAppearanceResolution,
} from '../subjects/active-character-appearance'
import type { CharacterAppearanceLike } from '../subjects/subjects-client-helpers'

export interface StoryboardEpisodeBinding {
  characterId: string
  appearanceId: string | null
}

export interface StoryboardAppearanceCharacter {
  id: string
  name: string
  voiceDescription?: string | null
  appearances?: CharacterAppearanceLike[] | null
}

export type StoryboardResolvedAppearanceCharacter = Omit<
  StoryboardAppearanceCharacter,
  'appearances'
> & {
  appearances?: CharacterAppearanceLike[]
}

export interface StoryboardAppearancePanel {
  id: string
  characters?: Array<string | { name: string; appearance?: string }> | null
  description?: string | null
  videoPrompt?: string | null
  srtSegment?: string | null
}

export type StoryboardEpisodeAppearanceGate =
  | { status: 'ready' }
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'binding-missing' | 'stale-binding' | 'no-appearance'
      characterId: string
      characterName: string
    }

export interface StoryboardEpisodeAppearanceViewModel {
  canGenerate: boolean
  gate: StoryboardEpisodeAppearanceGate
  characterRoster: StoryboardResolvedAppearanceCharacter[]
  resolutionByCharacterId: ReadonlyMap<string, ActiveCharacterAppearanceResolution>
}

export function deriveStoryboardEpisodeAppearanceBindingState({
  episodeId,
  bindings,
  isPending,
  isFetching,
  error,
}: {
  episodeId: string | null | undefined
  bindings: readonly StoryboardEpisodeBinding[] | null | undefined
  isPending: boolean
  isFetching: boolean
  error: unknown
}): ActiveCharacterAppearanceBindingState {
  if (!episodeId) return { status: 'ready', bindingMap: new Map() }
  if (error) return { status: 'error' }
  if (isPending || isFetching) return { status: 'loading' }

  const bindingMap = new Map<string, string | null>()
  for (const binding of bindings ?? []) {
    bindingMap.set(binding.characterId, binding.appearanceId)
  }
  return { status: 'ready', bindingMap }
}

function readPanelCharacterName(value: string | { name: string }): string | null {
  if (typeof value !== 'string') return value.name.trim() || null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('{')) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as { name?: unknown }
    return typeof parsed.name === 'string' && parsed.name.trim()
      ? parsed.name.trim()
      : trimmed
  } catch {
    return trimmed
  }
}

function findCharacterByReference(
  characters: readonly StoryboardAppearanceCharacter[],
  referenceName: string,
): StoryboardAppearanceCharacter | null {
  const referenceAliases = referenceName
    .toLowerCase()
    .split('/')
    .map((alias) => alias.trim())
    .filter(Boolean)
  if (referenceAliases.length === 0) return null
  return characters.find((character) => {
    const aliases = character.name
      .toLowerCase()
      .split('/')
      .map((alias) => alias.trim())
      .filter(Boolean)
    return referenceAliases.some((alias) => aliases.includes(alias))
  }) ?? null
}

function collectReferencedCharacterIds(
  panels: readonly StoryboardAppearancePanel[],
  characters: readonly StoryboardAppearanceCharacter[],
): Set<string> {
  const ids = new Set<string>()
  for (const panel of panels) {
    for (const rawReference of panel.characters ?? []) {
      const name = readPanelCharacterName(rawReference)
      if (!name) continue
      const character = findCharacterByReference(characters, name)
      if (character) ids.add(character.id)
    }

    const searchableText = [panel.description, panel.videoPrompt, panel.srtSegment]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('\n')
      .toLowerCase()
    if (!searchableText) continue
    for (const character of characters) {
      const aliases = character.name
        .toLowerCase()
        .split('/')
        .map((alias) => alias.trim())
        .filter(Boolean)
      if (aliases.some((alias) => searchableText.includes(alias))) {
        ids.add(character.id)
      }
    }
  }
  return ids
}

function unresolvedGate(
  resolution: ActiveCharacterAppearanceResolution,
  character: StoryboardAppearanceCharacter,
): StoryboardEpisodeAppearanceGate | null {
  if (resolution.status === 'resolved') return null
  if (resolution.status === 'loading' || resolution.status === 'error') {
    return { status: resolution.status }
  }
  if (resolution.status === 'missing') {
    return {
      status: resolution.reason,
      characterId: character.id,
      characterName: character.name,
    }
  }
  return {
    status: 'no-appearance',
    characterId: character.id,
    characterName: character.name,
  }
}

/**
 * Produces the only character roster Storyboard previews and pickers may use.
 * A selected episode collapses every resolved character to exactly one
 * appearance, so legacy panel hints and per-group overrides cannot expose A
 * when the authoritative episode binding points to B.
 */
export function buildStoryboardEpisodeAppearanceViewModel({
  episodeId,
  bindingState,
  characters,
  panels,
}: {
  episodeId: string | null | undefined
  bindingState: ActiveCharacterAppearanceBindingState
  characters: readonly StoryboardAppearanceCharacter[]
  panels: readonly StoryboardAppearancePanel[]
}): StoryboardEpisodeAppearanceViewModel {
  if (bindingState.status === 'loading' || bindingState.status === 'error') {
    return {
      canGenerate: false,
      gate: { status: bindingState.status },
      characterRoster: [],
      resolutionByCharacterId: new Map(),
    }
  }

  const referencedCharacterIds = collectReferencedCharacterIds(panels, characters)
  const resolutionByCharacterId = new Map<string, ActiveCharacterAppearanceResolution>()
  const characterRoster: StoryboardResolvedAppearanceCharacter[] = []

  for (const character of characters) {
    const resolution = resolveActiveCharacterAppearance({
      characterId: character.id,
      appearances: character.appearances,
      episodeId,
      bindingState,
    })
    resolutionByCharacterId.set(character.id, resolution)
    if (resolution.status === 'resolved') {
      characterRoster.push({
        ...character,
        appearances: [resolution.appearance],
      })
    }
  }

  for (const characterId of referencedCharacterIds) {
    const character = characters.find((candidate) => candidate.id === characterId)
    const resolution = resolutionByCharacterId.get(characterId)
    if (!character || !resolution) continue
    const gate = unresolvedGate(resolution, character)
    if (gate) {
      return {
        canGenerate: false,
        gate,
        characterRoster: [],
        resolutionByCharacterId,
      }
    }
  }

  return {
    canGenerate: true,
    gate: { status: 'ready' },
    characterRoster,
    resolutionByCharacterId,
  }
}

export type {
  ActiveCharacterAppearanceBindingState,
  ActiveCharacterAppearanceResolution,
}
