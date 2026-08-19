import type { CharacterAppearanceLike } from './subjects-client-helpers'

export type ActiveCharacterAppearanceBindingState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready'
      bindingMap: ReadonlyMap<string, string | null>
    }

type UnresolvedActiveCharacterAppearance = {
  appearance: null
  appearanceId: null
  mutationSafe: false
}

export type ActiveCharacterAppearanceResolution =
  | ({ status: 'loading' } & UnresolvedActiveCharacterAppearance)
  | ({ status: 'error' } & UnresolvedActiveCharacterAppearance)
  | ({
      status: 'missing'
      reason: 'binding-missing'
    } & UnresolvedActiveCharacterAppearance)
  | ({
      status: 'missing'
      reason: 'stale-binding'
      expectedAppearanceId: string
    } & UnresolvedActiveCharacterAppearance)
  | ({ status: 'no-appearance' } & UnresolvedActiveCharacterAppearance)
  | {
      status: 'resolved'
      source: 'episode' | 'default'
      appearance: CharacterAppearanceLike
      appearanceId: string
      mutationSafe: true
    }

export interface ResolveActiveCharacterAppearanceInput {
  characterId: string
  appearances: readonly CharacterAppearanceLike[] | null | undefined
  episodeId: string | null | undefined
  bindingState: ActiveCharacterAppearanceBindingState
}

function pickLowestIndexedAppearance(
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

/**
 * Resolves the only appearance the Subjects UI may display or mutate.
 *
 * A selected episode makes its binding row authoritative. Loading, failed,
 * missing, and stale bindings intentionally return no appearance: silently
 * falling back here would let a click mutate a different costume.
 */
export function resolveActiveCharacterAppearance({
  characterId,
  appearances: rawAppearances,
  episodeId,
  bindingState,
}: ResolveActiveCharacterAppearanceInput): ActiveCharacterAppearanceResolution {
  const appearances = rawAppearances ?? []

  if (!episodeId) {
    const appearance = pickLowestIndexedAppearance(appearances)
    if (!appearance) {
      return {
        status: 'no-appearance',
        appearance: null,
        appearanceId: null,
        mutationSafe: false,
      }
    }
    return {
      status: 'resolved',
      source: 'default',
      appearance,
      appearanceId: appearance.id,
      mutationSafe: true,
    }
  }

  if (bindingState.status === 'loading') {
    return {
      status: 'loading',
      appearance: null,
      appearanceId: null,
      mutationSafe: false,
    }
  }
  if (bindingState.status === 'error') {
    return {
      status: 'error',
      appearance: null,
      appearanceId: null,
      mutationSafe: false,
    }
  }
  if (!bindingState.bindingMap.has(characterId)) {
    return {
      status: 'missing',
      reason: 'binding-missing',
      appearance: null,
      appearanceId: null,
      mutationSafe: false,
    }
  }

  const boundAppearanceId = bindingState.bindingMap.get(characterId) ?? null
  if (boundAppearanceId) {
    const appearance = appearances.find((candidate) => candidate.id === boundAppearanceId)
    if (!appearance) {
      return {
        status: 'missing',
        reason: 'stale-binding',
        expectedAppearanceId: boundAppearanceId,
        appearance: null,
        appearanceId: null,
        mutationSafe: false,
      }
    }
    return {
      status: 'resolved',
      source: 'episode',
      appearance,
      appearanceId: appearance.id,
      mutationSafe: true,
    }
  }

  const appearance = pickLowestIndexedAppearance(appearances)
  if (!appearance) {
    return {
      status: 'no-appearance',
      appearance: null,
      appearanceId: null,
      mutationSafe: false,
    }
  }
  return {
    status: 'resolved',
    source: 'default',
    appearance,
    appearanceId: appearance.id,
    mutationSafe: true,
  }
}
