import { describe, expect, it } from 'vitest'
import {
  buildStoryboardEpisodeAppearanceViewModel,
  deriveStoryboardEpisodeAppearanceBindingState,
} from '@/app/[locale]/v2/workspace/[projectId]/storyboard/storyboard-episode-appearance-policy'

const appearanceA = {
  id: 'appearance-a',
  appearanceIndex: 0,
  changeReason: '日常服',
  imageUrl: '/a.jpg',
}
const appearanceB = {
  id: 'appearance-b',
  appearanceIndex: 1,
  changeReason: '戰鬥服',
  imageUrl: '/b.jpg',
}
const character = {
  id: 'character-1',
  name: '林真',
  appearances: [appearanceA, appearanceB],
}
const panels = [{
  id: 'panel-1',
  characters: [{ name: '林真', appearance: '日常服' }],
  description: '林真走進倉庫',
}]

describe('Storyboard episode appearance policy', () => {
  it.each([
    ['initial loading', { isPending: true, isFetching: false, error: null }],
    ['cached background refetch', { isPending: false, isFetching: true, error: null }],
  ])('[%s] -> reports loading and never treats cached bindings as ready', (_label, query) => {
    const state = deriveStoryboardEpisodeAppearanceBindingState({
      episodeId: 'episode-2',
      bindings: [{ characterId: 'character-1', appearanceId: 'appearance-a' }],
      ...query,
    })

    expect(state).toEqual({ status: 'loading' })
  })

  it('[cached query has an error while fetching] -> error wins and stale rows stay unusable', () => {
    const state = deriveStoryboardEpisodeAppearanceBindingState({
      episodeId: 'episode-2',
      bindings: [{ characterId: 'character-1', appearanceId: 'appearance-a' }],
      isPending: false,
      isFetching: true,
      error: new Error('offline'),
    })

    expect(state).toEqual({ status: 'error' })
  })

  it('[episode binds B while panel hints A] -> preview roster and generation target contain only B', () => {
    const viewModel = buildStoryboardEpisodeAppearanceViewModel({
      episodeId: 'episode-2',
      bindingState: {
        status: 'ready',
        bindingMap: new Map([['character-1', 'appearance-b']]),
      },
      characters: [character],
      panels,
    })

    expect(viewModel.canGenerate).toBe(true)
    expect(viewModel.gate).toEqual({ status: 'ready' })
    expect(viewModel.resolutionByCharacterId.get('character-1')?.appearanceId).toBe('appearance-b')
    expect(viewModel.characterRoster[0]?.appearances).toEqual([appearanceB])
    expect(viewModel.characterRoster[0]?.appearances).not.toContainEqual(appearanceA)
  })

  it('[binding is explicitly null] -> scopes the roster to deterministic lowest appearanceIndex', () => {
    const viewModel = buildStoryboardEpisodeAppearanceViewModel({
      episodeId: 'episode-2',
      bindingState: {
        status: 'ready',
        bindingMap: new Map([['character-1', null]]),
      },
      characters: [{ ...character, appearances: [appearanceB, appearanceA] }],
      panels,
    })

    expect(viewModel.canGenerate).toBe(true)
    expect(viewModel.characterRoster[0]?.appearances?.map((appearance) => appearance.id)).toEqual([
      'appearance-a',
    ])
  })

  it('[referenced character binding row is missing] -> blocks generation with a visible binding-missing state', () => {
    const viewModel = buildStoryboardEpisodeAppearanceViewModel({
      episodeId: 'episode-2',
      bindingState: { status: 'ready', bindingMap: new Map() },
      characters: [character],
      panels,
    })

    expect(viewModel.canGenerate).toBe(false)
    expect(viewModel.gate).toEqual({
      status: 'binding-missing',
      characterId: 'character-1',
      characterName: '林真',
    })
    expect(viewModel.characterRoster).toEqual([])
  })

  it('[binding points at deleted appearance] -> blocks generation and never exposes A', () => {
    const viewModel = buildStoryboardEpisodeAppearanceViewModel({
      episodeId: 'episode-2',
      bindingState: {
        status: 'ready',
        bindingMap: new Map([['character-1', 'appearance-deleted']]),
      },
      characters: [character],
      panels,
    })

    expect(viewModel.canGenerate).toBe(false)
    expect(viewModel.gate).toEqual({
      status: 'stale-binding',
      characterId: 'character-1',
      characterName: '林真',
    })
    expect(viewModel.characterRoster).toEqual([])
  })
})
