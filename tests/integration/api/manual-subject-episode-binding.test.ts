import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionCharacter: { create: vi.fn(), findUnique: vi.fn() },
  characterAppearance: { create: vi.fn() },
  episodeCharacter: { create: vi.fn() },
  novelPromotionLocation: { create: vi.fn(), findUnique: vi.fn() },
  locationImage: { create: vi.fn() },
  episodeLocation: { create: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('manual subject creation binds the active episode atomically', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-A')
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock))
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
  })

  it('creates character, primary appearance and EpisodeCharacter in one transaction', async () => {
    prismaMock.novelPromotionCharacter.create.mockResolvedValue({ id: 'character-1', name: '角色A' })
    prismaMock.characterAppearance.create.mockResolvedValue({ id: 'appearance-1' })
    prismaMock.episodeCharacter.create.mockResolvedValue({ id: 'episode-character-1' })
    prismaMock.novelPromotionCharacter.findUnique.mockResolvedValue({
      id: 'character-1',
      name: '角色A',
      appearances: [{ id: 'appearance-1' }],
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/character/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-1/character',
      method: 'POST',
      body: { name: '角色A', episodeId: 'episode-1' },
      context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: { id: 'episode-1', novelPromotionProjectId: 'novel-data-id' },
      select: { id: true },
    })
    expect(prismaMock.episodeCharacter.create).toHaveBeenCalledWith({
      data: {
        episodeId: 'episode-1',
        characterId: 'character-1',
        appearanceId: 'appearance-1',
        role: 'manual',
      },
    })
  })

  it('creates location, initial image row and EpisodeLocation in one transaction', async () => {
    prismaMock.novelPromotionLocation.create.mockResolvedValue({ id: 'location-1', name: '屋顶' })
    prismaMock.locationImage.create.mockResolvedValue({ id: 'location-image-1' })
    prismaMock.episodeLocation.create.mockResolvedValue({ id: 'episode-location-1' })
    prismaMock.novelPromotionLocation.findUnique.mockResolvedValue({
      id: 'location-1',
      name: '屋顶',
      images: [{ id: 'location-image-1' }],
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/location/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-1/location',
      method: 'POST',
      body: { name: '屋顶', episodeId: 'episode-1' },
      context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: { id: 'episode-1', novelPromotionProjectId: 'novel-data-id' },
      select: { id: true },
    })
    expect(prismaMock.episodeLocation.create).toHaveBeenCalledWith({
      data: { episodeId: 'episode-1', locationId: 'location-1', role: 'manual' },
    })
  })
})
