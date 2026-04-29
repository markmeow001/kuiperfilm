import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockUnauthenticated,
  resetAuthMockState,
} from '../../../helpers/auth'

/**
 * Phase 11.2 — GET /api/projects/[projectId]/characters
 *
 * 合約 (Q-1 A junction = SoT)：
 *   - 200: { success: true, data: { characters: [{ id, name, ..., episodes: [{ id, episodeNumber, name, role }] }] } }
 *   - episodes 從 EpisodeCharacter junction 拉，不從 panels.characters 反查
 *   - 401: 未登入
 *   - 403: 不擁有 project
 *   - 404: project 不存在 / NovelPromotionProject 不存在
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
  episodeCharacter: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
// 媒體掛載直接回傳輸入，避免外部呼叫
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (input: unknown) => input),
}))

describe('GET /api/projects/[projectId]/characters', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-1', userId: 'user-a' })
  })

  it('未登入 -> 401', async () => {
    installAuthMocks()
    mockUnauthenticated()

    const mod = await import('@/app/api/projects/[projectId]/characters/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/characters',
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

    const mod = await import('@/app/api/projects/[projectId]/characters/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-404/characters',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-404' }) })
    expect(res.status).toBe(404)
  })

  it('不擁有此 project -> 403', async () => {
    installAuthMocks()
    mockAuthenticated('user-b')
    prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-1', userId: 'user-a' })

    const mod = await import('@/app/api/projects/[projectId]/characters/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/characters',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(403)
  })

  it('NovelPromotionProject 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue(null)

    const mod = await import('@/app/api/projects/[projectId]/characters/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/characters',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(404)
  })

  it('回 array of character 含 episodes（從 junction 拉，不從 panels 反查）', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-1',
      characters: [
        {
          id: 'char-1',
          name: 'Hero',
          aliases: null,
          sourceGlobalCharacterId: null,
          appearances: [],
          episodeCharacters: [
            { role: 'auto-from-panel', episode: { id: 'ep-3', episodeNumber: 3, name: '第 3 集' } },
            { role: 'manual', episode: { id: 'ep-7', episodeNumber: 7, name: '第 7 集' } },
          ],
        },
        {
          id: 'char-2',
          name: 'Villain',
          aliases: null,
          sourceGlobalCharacterId: null,
          appearances: [],
          episodeCharacters: [],
        },
      ],
    })

    const mod = await import('@/app/api/projects/[projectId]/characters/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/characters',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      success: boolean
      data: {
        characters: Array<{
          id: string
          name: string
          episodes: Array<{ id: string; episodeNumber: number; name: string; role: string | null }>
        }>
      }
    }
    expect(body.success).toBe(true)
    expect(body.data.characters).toHaveLength(2)

    const hero = body.data.characters.find((c) => c.id === 'char-1')
    expect(hero).toBeDefined()
    expect(hero!.name).toBe('Hero')
    expect(hero!.episodes).toEqual([
      { id: 'ep-3', episodeNumber: 3, name: '第 3 集', role: 'auto-from-panel' },
      { id: 'ep-7', episodeNumber: 7, name: '第 7 集', role: 'manual' },
    ])

    const villain = body.data.characters.find((c) => c.id === 'char-2')
    expect(villain!.episodes).toEqual([])

    // 必須從 junction 拉，不從 panels 反查（Q-1 A）
    expect(prismaMock.novelPromotionPanel.findMany).not.toHaveBeenCalled()

    // findUnique 必須帶 include.characters.include.episodeCharacters
    const findArg = prismaMock.novelPromotionProject.findUnique.mock.calls[0][0]
    expect(findArg.where.projectId).toBe('proj-1')
    const charactersInclude = findArg.include?.characters
    expect(charactersInclude).toBeDefined()
    const ecInclude = charactersInclude.include?.episodeCharacters
    expect(ecInclude).toBeDefined()
    expect(ecInclude.include?.episode).toBeDefined()
  })

  it('查詢 where 帶 projectId (Project.id 作為 NovelPromotionProject.projectId 的索引)', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-1',
      characters: [],
    })

    const mod = await import('@/app/api/projects/[projectId]/characters/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/characters',
      method: 'GET',
    })
    await mod.GET(req, { params: Promise.resolve({ projectId: 'proj-1' }) })

    expect(prismaMock.novelPromotionProject.findUnique).toHaveBeenCalledTimes(1)
    const findArg = prismaMock.novelPromotionProject.findUnique.mock.calls[0][0]
    expect(findArg.where.projectId).toBe('proj-1')
  })
})
