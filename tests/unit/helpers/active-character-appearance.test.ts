import { describe, expect, it } from 'vitest'
import {
  resolveActiveCharacterAppearance,
  type ActiveCharacterAppearanceBindingState,
} from '@/app/[locale]/v2/workspace/[projectId]/subjects/active-character-appearance'

const appearanceA = {
  id: 'appearance-a',
  appearanceIndex: 0,
  changeReason: '日常服',
  description: 'A prompt',
  imageUrl: '/a.jpg',
}

const appearanceB = {
  id: 'appearance-b',
  appearanceIndex: 1,
  changeReason: '戰鬥服',
  description: 'B prompt',
  imageUrl: '/b.jpg',
}

function resolve(
  bindingState: ActiveCharacterAppearanceBindingState,
  appearances = [appearanceA, appearanceB],
) {
  return resolveActiveCharacterAppearance({
    characterId: 'character-1',
    appearances,
    episodeId: 'episode-2',
    bindingState,
  })
}

describe('resolveActiveCharacterAppearance', () => {
  it('[episode binds appearance B] -> resolves every target from B and never appearance A', () => {
    const result = resolve({
      status: 'ready',
      bindingMap: new Map([['character-1', 'appearance-b']]),
    })

    expect(result).toEqual({
      status: 'resolved',
      source: 'episode',
      appearance: appearanceB,
      appearanceId: 'appearance-b',
      mutationSafe: true,
    })
    expect(result.status === 'resolved' ? result.appearance.id : null).not.toBe('appearance-a')
  })

  it('[episode binding is explicitly null] -> falls back to the lowest appearanceIndex, not array order', () => {
    const result = resolve(
      {
        status: 'ready',
        bindingMap: new Map([['character-1', null]]),
      },
      [appearanceB, appearanceA],
    )

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') throw new Error('Expected resolved appearance')
    expect(result.source).toBe('default')
    expect(result.appearanceId).toBe('appearance-a')
  })

  it('[no episode selected] -> resolves the lowest appearanceIndex as the project default', () => {
    const result = resolveActiveCharacterAppearance({
      characterId: 'character-1',
      appearances: [appearanceB, appearanceA],
      episodeId: null,
      bindingState: { status: 'ready', bindingMap: new Map() },
    })

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') throw new Error('Expected resolved appearance')
    expect(result.source).toBe('default')
    expect(result.appearanceId).toBe('appearance-a')
  })

  it.each([
    ['loading', { status: 'loading' } as const],
    ['error', { status: 'error' } as const],
  ])('[episode bindings are %s] -> blocks mutations without falling back', (_label, bindingState) => {
    const result = resolve(bindingState)

    expect(result.status).toBe(bindingState.status)
    expect(result.mutationSafe).toBe(false)
    expect(result.appearance).toBeNull()
  })

  it('[character binding row is missing] -> reports missing binding and blocks mutations', () => {
    const result = resolve({ status: 'ready', bindingMap: new Map() })

    expect(result).toEqual({
      status: 'missing',
      reason: 'binding-missing',
      appearance: null,
      appearanceId: null,
      mutationSafe: false,
    })
  })

  it('[binding points at a deleted appearance] -> reports stale binding and never falls back to appearance A', () => {
    const result = resolve({
      status: 'ready',
      bindingMap: new Map([['character-1', 'appearance-deleted']]),
    })

    expect(result).toEqual({
      status: 'missing',
      reason: 'stale-binding',
      expectedAppearanceId: 'appearance-deleted',
      appearance: null,
      appearanceId: null,
      mutationSafe: false,
    })
  })

  it('[null binding and no appearances] -> reports no appearance and blocks mutations', () => {
    const result = resolve(
      { status: 'ready', bindingMap: new Map([['character-1', null]]) },
      [],
    )

    expect(result).toEqual({
      status: 'no-appearance',
      appearance: null,
      appearanceId: null,
      mutationSafe: false,
    })
  })
})
