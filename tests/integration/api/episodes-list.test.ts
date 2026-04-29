import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockUnauthenticated,
  mockProjectAuth,
  resetAuthMockState,
} from '../../helpers/auth'

/**
 * Phase 11.1 — GET /api/novel-promotion/[projectId]/episodes
 *
 * 合約：
 *   - 200: { episodes: [{ id, episodeNumber, name, description, progress, thumbnailUrl, ... }] }
 *   - progress 含 6 個欄位：scriptDone/Total, storyboardDone/Total, videoDone/Total
 *   - thumbnailUrl 取第一個 storyboard panel.imageUrl；無則 fallback shot.imageUrl；都無則 null
 *   - 401: 未登入
 *   - 403/404: 不擁有此 project
 */

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('GET /api/novel-promotion/[projectId]/episodes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
  })

  it('未登入 -> 401', async () => {
    installAuthMocks()
    mockUnauthenticated()
    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/proj-1/episodes',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(401)
    expect(prismaMock.novelPromotionEpisode.findMany).not.toHaveBeenCalled()
  })

  it('不擁有此 project (forbidden) -> 403', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    mockProjectAuth('forbidden')
    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/proj-1/episodes',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(403)
    expect(prismaMock.novelPromotionEpisode.findMany).not.toHaveBeenCalled()
  })

  it('project 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    mockProjectAuth('not_found')
    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/proj-404/episodes',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-404' }) })
    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findMany).not.toHaveBeenCalled()
  })

  it('有 2 集 -> 回 array of episode 含 progress 與 thumbnailUrl', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([
      {
        id: 'ep-1',
        episodeNumber: 1,
        name: '第 1 集',
        description: 'first ep',
        novelText: 'novel...',
        createdAt: new Date('2026-04-01T00:00:00Z'),
        updatedAt: new Date('2026-04-02T00:00:00Z'),
        clips: [
          { id: 'c1', screenplay: 'INT. ROOM' },
          { id: 'c2', screenplay: null },
        ],
        storyboards: [
          {
            id: 'sb-1',
            panels: [
              { id: 'p1', imageUrl: 'https://cdn/ep1-p1.png', videoUrl: 'https://cdn/ep1-p1.mp4' },
              { id: 'p2', imageUrl: 'https://cdn/ep1-p2.png', videoUrl: null },
              { id: 'p3', imageUrl: null, videoUrl: null },
            ],
          },
        ],
        shots: [{ id: 's1', imageUrl: 'https://cdn/ep1-shot.png' }],
      },
      {
        id: 'ep-2',
        episodeNumber: 2,
        name: '第 2 集',
        description: null,
        novelText: null,
        createdAt: new Date('2026-04-03T00:00:00Z'),
        updatedAt: new Date('2026-04-04T00:00:00Z'),
        clips: [],
        storyboards: [],
        shots: [],
      },
    ])

    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/proj-1/episodes',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      episodes: Array<{
        id: string
        episodeNumber: number
        name: string
        description: string | null
        progress: {
          scriptDone: number
          scriptTotal: number
          storyboardDone: number
          storyboardTotal: number
          videoDone: number
          videoTotal: number
        }
        thumbnailUrl: string | null
      }>
    }

    expect(Array.isArray(body.episodes)).toBe(true)
    expect(body.episodes).toHaveLength(2)

    const ep1 = body.episodes[0]
    expect(ep1.id).toBe('ep-1')
    expect(ep1.episodeNumber).toBe(1)
    expect(ep1.name).toBe('第 1 集')
    expect(ep1.description).toBe('first ep')

    // progress 結構正確（6 個欄位）+ 數值正確
    expect(ep1.progress).toEqual({
      scriptDone: 1,
      scriptTotal: 2,
      storyboardDone: 2,
      storyboardTotal: 3,
      videoDone: 1,
      videoTotal: 3,
    })

    // thumbnailUrl 來自第一個 panel.imageUrl
    expect(ep1.thumbnailUrl).toBe('https://cdn/ep1-p1.png')

    // 第 2 集無 storyboard / 無 shot -> 全 0 + thumbnailUrl null
    const ep2 = body.episodes[1]
    expect(ep2.id).toBe('ep-2')
    expect(ep2.progress).toEqual({
      scriptDone: 0,
      scriptTotal: 0,
      storyboardDone: 0,
      storyboardTotal: 0,
      videoDone: 0,
      videoTotal: 0,
    })
    expect(ep2.thumbnailUrl).toBeNull()
  })

  it('有 storyboard 但 panel imageUrl 全空 + 有 shots 第一個有 imageUrl -> thumbnailUrl 用 shot', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([
      {
        id: 'ep-3',
        episodeNumber: 3,
        name: '第 3 集',
        description: null,
        novelText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        clips: [],
        storyboards: [
          {
            id: 'sb-3',
            panels: [
              { id: 'p1', imageUrl: null, videoUrl: null },
              { id: 'p2', imageUrl: '', videoUrl: null },
            ],
          },
        ],
        shots: [
          { id: 's1', imageUrl: 'https://cdn/shot-fallback.png' },
        ],
      },
    ])

    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/proj-1/episodes',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      episodes: Array<{ thumbnailUrl: string | null }>
    }
    expect(body.episodes[0].thumbnailUrl).toBe('https://cdn/shot-fallback.png')
  })

  it('查詢只 select 必要欄位 (避免拉到 prompt / imageHistory 等大欄位)', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([])

    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/proj-1/episodes',
      method: 'GET',
    })
    await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })

    expect(prismaMock.novelPromotionEpisode.findMany).toHaveBeenCalledTimes(1)
    const call = prismaMock.novelPromotionEpisode.findMany.mock.calls[0]?.[0]
    expect(call).toBeDefined()
    expect(call.where.novelPromotionProjectId).toBe('novel-data-id')
    // 必須使用 select 而非預設拉 *（避免帶到大欄位）
    expect(call.select).toBeDefined()
    expect(call.select.id).toBe(true)
    expect(call.select.episodeNumber).toBe(true)
    expect(call.select.name).toBe(true)
    expect(call.select.clips).toBeDefined()
    expect(call.select.storyboards).toBeDefined()
    // 不應 select prompt / imageHistory / candidateImages 等大欄位
    expect(call.select.imageHistory).toBeUndefined()
  })

  it('回傳依 episodeNumber 升冪排序', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([])

    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/proj-1/episodes',
      method: 'GET',
    })
    await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })

    const call = prismaMock.novelPromotionEpisode.findMany.mock.calls[0]?.[0]
    expect(call.orderBy).toEqual({ episodeNumber: 'asc' })
  })
})
