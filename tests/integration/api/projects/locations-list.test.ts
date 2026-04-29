import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockUnauthenticated,
  resetAuthMockState,
} from '../../../helpers/auth'

/**
 * Phase 11.2 — GET /api/projects/[projectId]/locations
 *
 * 合約 (Q-1 A junction = SoT)：
 *   - 200: { success: true, data: { locations: [{ id, name, ..., episodes: [...] }] } }
 *   - episodes 從 EpisodeLocation junction 拉，不從 panels.location 反查
 */

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  novelPromotionPanel: {
    findMany: vi.fn(),
  },
  episodeLocation: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (input: unknown) => input),
}))

describe('GET /api/projects/[projectId]/locations', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-1', userId: 'user-a' })
  })

  it('未登入 -> 401', async () => {
    installAuthMocks()
    mockUnauthenticated()

    const mod = await import('@/app/api/projects/[projectId]/locations/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/locations',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(401)
    expect(prismaMock.novelPromotionProject.findUnique).not.toHaveBeenCalled()
  })

  it('project 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.project.findUnique.mockResolvedValue(null)

    const mod = await import('@/app/api/projects/[projectId]/locations/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-404/locations',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-404' }) })
    expect(res.status).toBe(404)
  })

  it('不擁有此 project -> 403', async () => {
    installAuthMocks()
    mockAuthenticated('user-b')
    prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-1', userId: 'user-a' })

    const mod = await import('@/app/api/projects/[projectId]/locations/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/locations',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(403)
  })

  it('NovelPromotionProject 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue(null)

    const mod = await import('@/app/api/projects/[projectId]/locations/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/locations',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(404)
  })

  it('回 array of location 含 episodes（從 junction 拉，不從 panels 反查）', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-1',
      locations: [
        {
          id: 'loc-1',
          name: '客廳',
          summary: null,
          sourceGlobalLocationId: null,
          images: [],
          episodeLocations: [
            { role: 'auto-from-panel', episode: { id: 'ep-1', episodeNumber: 1, name: '第 1 集' } },
            { role: 'manual', episode: { id: 'ep-5', episodeNumber: 5, name: '第 5 集' } },
          ],
        },
        {
          id: 'loc-2',
          name: '廚房',
          summary: null,
          sourceGlobalLocationId: null,
          images: [],
          episodeLocations: [],
        },
      ],
    })

    const mod = await import('@/app/api/projects/[projectId]/locations/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/locations',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      success: boolean
      data: {
        locations: Array<{
          id: string
          name: string
          episodes: Array<{ id: string; episodeNumber: number; name: string; role: string | null }>
        }>
      }
    }
    expect(body.data.locations).toHaveLength(2)

    const livingRoom = body.data.locations.find((l) => l.id === 'loc-1')
    expect(livingRoom!.episodes).toEqual([
      { id: 'ep-1', episodeNumber: 1, name: '第 1 集', role: 'auto-from-panel' },
      { id: 'ep-5', episodeNumber: 5, name: '第 5 集', role: 'manual' },
    ])

    const kitchen = body.data.locations.find((l) => l.id === 'loc-2')
    expect(kitchen!.episodes).toEqual([])

    // 必須從 junction 拉，不從 panels 反查
    expect(prismaMock.novelPromotionPanel.findMany).not.toHaveBeenCalled()

    const findArg = prismaMock.novelPromotionProject.findUnique.mock.calls[0][0]
    const locInclude = findArg.include?.locations
    expect(locInclude).toBeDefined()
    const elInclude = locInclude.include?.episodeLocations
    expect(elInclude).toBeDefined()
    expect(elInclude.include?.episode).toBeDefined()
  })

  it('查詢 where 帶 projectId', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-1',
      locations: [],
    })

    const mod = await import('@/app/api/projects/[projectId]/locations/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/locations',
      method: 'GET',
    })
    await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })

    const findArg = prismaMock.novelPromotionProject.findUnique.mock.calls[0][0]
    expect(findArg.where.projectId).toBe('proj-1')
  })
})
