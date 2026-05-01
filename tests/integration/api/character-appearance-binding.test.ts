/**
 * Multi-appearance binding endpoint regression
 * (commit b5d9f42 — Phase 11.4 / multi-appearance Stage 1).
 *
 * Verifies that GET / PATCH /api/.../episodes/:episodeId/character-appearance
 * - chains ownership (project + character + appearance must line up)
 * - rejects mismatched appearanceId (not owned by character)
 * - upserts EpisodeCharacter with appearanceId
 * - accepts null to clear binding
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionCharacter: { findFirst: vi.fn() },
  characterAppearance: { findFirst: vi.fn() },
  episodeCharacter: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
})

afterEach(() => {
  vi.resetAllMocks()
})

const PROJECT = 'project-1'
const EPISODE = 'episode-1'
const CHARACTER = 'character-1'
const APPEARANCE = 'appearance-1'

describe('character-appearance binding', () => {
  it('GET returns bindings for a valid episode', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: EPISODE })
    prismaMock.episodeCharacter.findMany.mockResolvedValueOnce([
      { id: 'ec-1', characterId: CHARACTER, appearanceId: APPEARANCE, role: 'manual', character: { name: 'Catherine' }, appearance: { id: APPEARANCE, appearanceIndex: 0, changeReason: '初始形象', imageUrl: null } },
    ])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/character-appearance/route')
    const res = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/character-appearance`,
      method: 'GET',
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { bindings: Array<{ characterId: string }> }
    expect(body.bindings).toHaveLength(1)
    expect(body.bindings[0].characterId).toBe(CHARACTER)
  })

  it('GET 404 when episode not in project (isolation)', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/character-appearance/route')
    const res = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/foreign-episode/character-appearance`,
      method: 'GET',
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: 'foreign-episode' }) } as never,
    })

    expect(res.status).toBe(404)
  })

  it('PATCH 400 when characterId missing', async () => {
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/character-appearance/route')
    const res = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/character-appearance`,
      method: 'PATCH',
      body: { appearanceId: APPEARANCE },
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.episodeCharacter.upsert).not.toHaveBeenCalled()
  })

  it('PATCH rejects appearanceId not owned by the character', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: EPISODE })
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce({ id: CHARACTER })
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null) // appearance not for this character

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/character-appearance/route')
    const res = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/character-appearance`,
      method: 'PATCH',
      body: { characterId: CHARACTER, appearanceId: 'wrong-appearance' },
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.episodeCharacter.upsert).not.toHaveBeenCalled()
  })

  it('PATCH upserts binding when all checks pass', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: EPISODE })
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce({ id: CHARACTER })
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce({ id: APPEARANCE })
    prismaMock.episodeCharacter.upsert.mockResolvedValueOnce({
      id: 'ec-1',
      episodeId: EPISODE,
      characterId: CHARACTER,
      appearanceId: APPEARANCE,
      role: 'manual',
    })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/character-appearance/route')
    const res = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/character-appearance`,
      method: 'PATCH',
      body: { characterId: CHARACTER, appearanceId: APPEARANCE },
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(200)
    expect(prismaMock.episodeCharacter.upsert).toHaveBeenCalledTimes(1)
    const call = prismaMock.episodeCharacter.upsert.mock.calls[0][0] as {
      where: { episodeId_characterId: { episodeId: string; characterId: string } }
      create: { appearanceId: string | null }
      update: { appearanceId: string | null }
    }
    expect(call.where.episodeId_characterId).toEqual({ episodeId: EPISODE, characterId: CHARACTER })
    expect(call.create.appearanceId).toBe(APPEARANCE)
    expect(call.update.appearanceId).toBe(APPEARANCE)
  })

  it('PATCH accepts appearanceId=null to clear binding', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: EPISODE })
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce({ id: CHARACTER })
    prismaMock.episodeCharacter.upsert.mockResolvedValueOnce({
      id: 'ec-1',
      episodeId: EPISODE,
      characterId: CHARACTER,
      appearanceId: null,
      role: 'manual',
    })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/character-appearance/route')
    const res = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/character-appearance`,
      method: 'PATCH',
      body: { characterId: CHARACTER, appearanceId: null },
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(200)
    // characterAppearance.findFirst should NOT be called when appearanceId is null
    expect(prismaMock.characterAppearance.findFirst).not.toHaveBeenCalled()
    const call = prismaMock.episodeCharacter.upsert.mock.calls[0][0] as { create: { appearanceId: null } }
    expect(call.create.appearanceId).toBeNull()
  })
})
