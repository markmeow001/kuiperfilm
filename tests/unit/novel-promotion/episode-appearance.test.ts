import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  canonicalizeEpisodeCharacterAppearances,
  EpisodeAppearanceResolutionError,
} from '@/lib/novel-promotion/episode-appearance'

const appearanceA = {
  id: 'appearance-a',
  appearanceIndex: 0,
  changeReason: 'A',
  description: 'appearance A',
  descriptions: null,
  imageUrl: 'characters/a.png',
  imageUrls: JSON.stringify(['characters/a.png']),
  selectedIndex: 0,
}

const appearanceB = {
  id: 'appearance-b',
  appearanceIndex: 1,
  changeReason: 'B',
  description: 'appearance B',
  descriptions: null,
  imageUrl: 'characters/b.png',
  imageUrls: JSON.stringify(['characters/b.png']),
  selectedIndex: 0,
}

function projectData(appearances = [appearanceA, appearanceB]) {
  return {
    videoRatio: '16:9',
    characters: [{ id: 'character-1', name: 'Hero/英雄', appearances }],
    locations: [],
    props: [],
  }
}

function bindings(appearanceId: string | null) {
  prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
    id: 'episode-1',
    episodeCharacters: [{ characterId: 'character-1', appearanceId }],
  })
}

describe('canonical episode character appearances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('episode binding B beats panel hint A and per-call override A', async () => {
    bindings('appearance-b')

    const result = await canonicalizeEpisodeCharacterAppearances({
      projectId: 'project-1',
      episodeId: 'episode-1',
      projectData: projectData(),
      panels: [{
        characters: JSON.stringify([{ name: 'Hero', appearance: 'A' }]),
        description: null,
        videoPrompt: null,
        srtSegment: null,
      }],
      characterOverrides: [{ characterId: 'character-1', appearanceId: 'appearance-a' }],
    })

    expect(result.characters).toHaveLength(1)
    expect(result.characters?.[0]?.appearances).toEqual([appearanceB])
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-1',
        novelPromotionProject: { projectId: 'project-1' },
      },
      select: {
        id: true,
        episodeCharacters: {
          select: { characterId: true, appearanceId: true },
        },
      },
    })
  })

  it('explicit null binding chooses lowest appearanceIndex then id deterministically', async () => {
    bindings(null)
    const sameIndexC = { ...appearanceA, id: 'appearance-c', appearanceIndex: 1 }
    const sameIndexB = { ...appearanceB, id: 'appearance-b', appearanceIndex: 1 }
    const later = { ...appearanceA, id: 'appearance-z', appearanceIndex: 3 }

    const result = await canonicalizeEpisodeCharacterAppearances({
      projectId: 'project-1',
      episodeId: 'episode-1',
      projectData: projectData([later, sameIndexC, sameIndexB]),
      panels: [{
        characters: '[]',
        description: '英雄 walks into frame',
        videoPrompt: null,
        srtSegment: null,
      }],
    })

    expect(result.characters?.[0]?.appearances).toEqual([sameIndexB])
  })

  it('unions panel JSON, prose, SRT, raw prompt, and force-included override references', async () => {
    const characters = [
      { id: 'char-json', name: 'JSON Hero', appearances: [appearanceA] },
      { id: 'char-desc', name: 'Desc Hero', appearances: [{ ...appearanceA, id: 'desc-a' }] },
      { id: 'char-video', name: 'Video Hero', appearances: [{ ...appearanceA, id: 'video-a' }] },
      { id: 'char-srt', name: 'SRT Hero', appearances: [{ ...appearanceA, id: 'srt-a' }] },
      { id: 'char-raw', name: 'Raw Hero', appearances: [{ ...appearanceA, id: 'raw-a' }] },
      { id: 'char-override', name: 'Override Hero', appearances: [{ ...appearanceA, id: 'override-a' }] },
      { id: 'char-unused', name: 'Unused Hero', appearances: [{ ...appearanceA, id: 'unused-a' }] },
    ]
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-1',
      episodeCharacters: characters.slice(0, 6).map((character) => ({
        characterId: character.id,
        appearanceId: null,
      })),
    })

    const result = await canonicalizeEpisodeCharacterAppearances({
      projectId: 'project-1',
      episodeId: 'episode-1',
      projectData: { ...projectData(), characters },
      panels: [{
        characters: JSON.stringify([{ name: 'JSON Hero' }]),
        description: 'Desc Hero enters.',
        videoPrompt: 'Cut to Video Hero.',
        srtSegment: 'SRT Hero: hello',
      }],
      extraMiningText: '@Raw Hero turns around.',
      characterOverrides: [{ characterId: 'char-override', appearanceId: 'ignored-for-priority' }],
    })

    expect(result.characters?.map((character) => character.id)).toEqual([
      'char-json',
      'char-desc',
      'char-video',
      'char-srt',
      'char-raw',
      'char-override',
    ])
  })

  it.each([
    {
      name: 'missing binding row',
      episodeCharacters: [],
      appearances: [appearanceA],
      code: 'EPISODE_APPEARANCE_BINDING_MISSING',
    },
    {
      name: 'stale binding row',
      episodeCharacters: [{ characterId: 'character-1', appearanceId: 'appearance-deleted' }],
      appearances: [appearanceA],
      code: 'EPISODE_APPEARANCE_BINDING_STALE',
    },
    {
      name: 'malformed empty-string binding row',
      episodeCharacters: [{ characterId: 'character-1', appearanceId: '' }],
      appearances: [appearanceA],
      code: 'EPISODE_APPEARANCE_BINDING_STALE',
    },
    {
      name: 'no appearance rows',
      episodeCharacters: [{ characterId: 'character-1', appearanceId: null }],
      appearances: [],
      code: 'EPISODE_APPEARANCE_NOT_FOUND',
    },
  ])('fails closed for $name', async ({ episodeCharacters, appearances, code }) => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1', episodeCharacters })

    const promise = canonicalizeEpisodeCharacterAppearances({
      projectId: 'project-1',
      episodeId: 'episode-1',
      projectData: projectData(appearances),
      panels: [{
        characters: JSON.stringify([{ name: 'Hero' }]),
        description: null,
        videoPrompt: null,
        srtSegment: null,
      }],
    })

    await expect(promise).rejects.toMatchObject({
      name: 'EpisodeAppearanceResolutionError',
      code: code as EpisodeAppearanceResolutionError['code'],
      characterId: 'character-1',
    } satisfies Partial<EpisodeAppearanceResolutionError>)
  })

  it('turns binding query failure into an explicit fail-closed error', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockRejectedValue(new Error('database unavailable'))

    const promise = canonicalizeEpisodeCharacterAppearances({
      projectId: 'project-1',
      episodeId: 'episode-1',
      projectData: projectData(),
      panels: [{
        characters: JSON.stringify([{ name: 'Hero' }]),
        description: null,
        videoPrompt: null,
        srtSegment: null,
      }],
    })

    await expect(promise).rejects.toMatchObject({
      code: 'EPISODE_APPEARANCE_BINDINGS_LOAD_FAILED',
    })
  })
})
