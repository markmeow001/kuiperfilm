import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: { findFirst: vi.fn() },
  episodeProp: { findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
})

describe('episode prop binding', () => {
  it('[集數屬於專案] -> [只回傳該集數的道具 binding]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-1' })
    prismaMock.episodeProp.findMany.mockResolvedValueOnce([
      { id: 'binding-1', propId: 'prop-1', role: 'manual', prop: { name: '信件' } },
    ])

    const { GET } = await import(
      '@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/props/route'
    )
    const res = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-1/episodes/episode-1/props',
      method: 'GET',
      context: {
        params: Promise.resolve({ projectId: 'project-1', episodeId: 'episode-1' }),
      } as never,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      bindings: [
        { id: 'binding-1', propId: 'prop-1', role: 'manual', prop: { name: '信件' } },
      ],
    })
    expect(prismaMock.episodeProp.findMany.mock.calls[0][0]).toMatchObject({
      where: { episodeId: 'episode-1' },
    })
  })

  it('[集數不屬於專案] -> [回傳 404 且不洩漏 binding]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { GET } = await import(
      '@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/props/route'
    )
    const res = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-1/episodes/foreign/props',
      method: 'GET',
      context: {
        params: Promise.resolve({ projectId: 'project-1', episodeId: 'foreign' }),
      } as never,
    })

    expect(res.status).toBe(404)
    expect(prismaMock.episodeProp.findMany).not.toHaveBeenCalled()
  })
})
