/**
 * Phase 11.3 — Props (first-class assets) regression coverage.
 *
 * Covers per-project /api/novel-promotion/:id/prop CRUD + asset-hub
 * /api/asset-hub/props + single-prop /api/asset-hub/props/:id endpoints.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockRole,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  globalProp: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(async () => ({})),
  },
  globalAssetFolder: { findUnique: vi.fn() },
  novelPromotionProject: { findUnique: vi.fn() },
  novelPromotionProp: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(async () => ({})),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
  mockRole('editor') // editor can write to asset-hub team-shared
  prismaMock.globalProp.findMany.mockImplementation(async () => [])
  prismaMock.novelPromotionProp.findMany.mockImplementation(async () => [])
  prismaMock.globalProp.delete.mockImplementation(async () => ({}))
  prismaMock.novelPromotionProp.delete.mockImplementation(async () => ({}))
})

afterEach(() => {
  vi.resetAllMocks()
})

const PROJECT = 'project-1'

// ======= ASSET-HUB =======

describe('GET /api/asset-hub/props', () => {
  it('returns the list (any authed user)', async () => {
    mockRole('member')
    prismaMock.globalProp.findMany.mockResolvedValueOnce([
      { id: 'p1', name: '小刀', summary: null, imageUrl: null },
    ])

    const { GET } = await import('@/app/api/asset-hub/props/route')
    const res = await callRoute(GET as never, {
      path: '/api/asset-hub/props',
      method: 'GET',
      context: undefined as never,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { props: Array<{ name: string }> }
    expect(body.props).toHaveLength(1)
    expect(body.props[0].name).toBe('小刀')
  })

  it('filters by folderId=null (orphaned props)', async () => {
    const { GET } = await import('@/app/api/asset-hub/props/route')
    await callRoute(GET as never, {
      path: '/api/asset-hub/props?folderId=null',
      method: 'GET',
      query: { folderId: 'null' },
      context: undefined as never,
    })
    const call = prismaMock.globalProp.findMany.mock.calls[0][0] as { where: { folderId: null | string } }
    expect(call.where.folderId).toBeNull()
  })
})

describe('POST /api/asset-hub/props', () => {
  it('rejects member role (write requires editor+)', async () => {
    mockRole('member')

    const { POST } = await import('@/app/api/asset-hub/props/route')
    const res = await callRoute(POST as never, {
      path: '/api/asset-hub/props',
      method: 'POST',
      body: { name: 'Test prop' },
      context: undefined as never,
    })

    expect(res.status).toBe(403)
    expect(prismaMock.globalProp.create).not.toHaveBeenCalled()
  })

  it('400 when name missing', async () => {
    const { POST } = await import('@/app/api/asset-hub/props/route')
    const res = await callRoute(POST as never, {
      path: '/api/asset-hub/props',
      method: 'POST',
      body: { summary: 'no name' },
      context: undefined as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.globalProp.create).not.toHaveBeenCalled()
  })

  it('happy path creates with userId = caller', async () => {
    prismaMock.globalProp.create.mockResolvedValueOnce({ id: 'p-new', name: '剪刀' })

    const { POST } = await import('@/app/api/asset-hub/props/route')
    const res = await callRoute(POST as never, {
      path: '/api/asset-hub/props',
      method: 'POST',
      body: { name: '剪刀', summary: '客廳掛在牆上' },
      context: undefined as never,
    })

    expect(res.status).toBe(200)
    const call = prismaMock.globalProp.create.mock.calls[0][0] as { data: { userId: string; name: string; summary: string } }
    expect(call.data.userId).toBe('user-A')
    expect(call.data.name).toBe('剪刀')
    expect(call.data.summary).toBe('客廳掛在牆上')
  })
})

describe('PATCH/DELETE /api/asset-hub/props/[id]', () => {
  it('PATCH 404 when prop does not exist', async () => {
    prismaMock.globalProp.findUnique.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/asset-hub/props/[id]/route')
    const res = await callRoute(PATCH as never, {
      path: '/api/asset-hub/props/missing',
      method: 'PATCH',
      body: { name: 'rename' },
      context: { params: Promise.resolve({ id: 'missing' }) } as never,
    })

    expect(res.status).toBe(404)
    expect(prismaMock.globalProp.update).not.toHaveBeenCalled()
  })

  it('PATCH renames an existing prop', async () => {
    prismaMock.globalProp.findUnique.mockResolvedValueOnce({ id: 'p1' })
    prismaMock.globalProp.update.mockResolvedValueOnce({ id: 'p1', name: '新名字' })

    const { PATCH } = await import('@/app/api/asset-hub/props/[id]/route')
    const res = await callRoute(PATCH as never, {
      path: '/api/asset-hub/props/p1',
      method: 'PATCH',
      body: { name: '新名字' },
      context: { params: Promise.resolve({ id: 'p1' }) } as never,
    })

    expect(res.status).toBe(200)
    const call = prismaMock.globalProp.update.mock.calls[0][0] as { where: { id: string }; data: { name: string } }
    expect(call.data.name).toBe('新名字')
  })

  it('DELETE removes existing prop', async () => {
    prismaMock.globalProp.findUnique.mockResolvedValueOnce({ id: 'p1' })

    const { DELETE } = await import('@/app/api/asset-hub/props/[id]/route')
    const res = await callRoute(DELETE as never, {
      path: '/api/asset-hub/props/p1',
      method: 'DELETE',
      context: { params: Promise.resolve({ id: 'p1' }) } as never,
    })

    expect(res.status).toBe(200)
    expect(prismaMock.globalProp.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })
})

// ======= PER-PROJECT =======

describe('POST /api/novel-promotion/:projectId/prop', () => {
  it('400 when name missing', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/prop/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/prop`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.novelPromotionProp.create).not.toHaveBeenCalled()
  })

  it('happy path creates with novelPromotionProjectId resolved', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({ id: 'np-1' })
    prismaMock.novelPromotionProp.create.mockResolvedValueOnce({ id: 'pp-1', name: '信件' })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/prop/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/prop`,
      method: 'POST',
      body: { name: '信件', summary: '父親留下的' },
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(200)
    const call = prismaMock.novelPromotionProp.create.mock.calls[0][0] as { data: { novelPromotionProjectId: string; name: string } }
    expect(call.data.novelPromotionProjectId).toBe('np-1')
    expect(call.data.name).toBe('信件')
  })
})

describe('PATCH /api/novel-promotion/:projectId/prop', () => {
  it('404 when prop is in a different project (isolation)', async () => {
    prismaMock.novelPromotionProp.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/prop/route')
    const res = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT}/prop`,
      method: 'PATCH',
      body: { propId: 'foreign-prop', name: 'pwn' },
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionProp.update).not.toHaveBeenCalled()
    const call = prismaMock.novelPromotionProp.findFirst.mock.calls[0][0] as { where: { novelPromotionProject: { projectId: string } } }
    expect(call.where.novelPromotionProject.projectId).toBe(PROJECT)
  })

  it('happy path updates name + summary', async () => {
    prismaMock.novelPromotionProp.findFirst.mockResolvedValueOnce({ id: 'pp-1' })
    prismaMock.novelPromotionProp.update.mockResolvedValueOnce({ id: 'pp-1', name: '新名' })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/prop/route')
    const res = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT}/prop`,
      method: 'PATCH',
      body: { propId: 'pp-1', name: '新名', summary: '新描述' },
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(200)
    const call = prismaMock.novelPromotionProp.update.mock.calls[0][0] as { data: { name: string; summary: string } }
    expect(call.data.name).toBe('新名')
    expect(call.data.summary).toBe('新描述')
  })
})

describe('DELETE /api/novel-promotion/:projectId/prop', () => {
  it('404 when prop not in project', async () => {
    prismaMock.novelPromotionProp.findFirst.mockResolvedValueOnce(null)

    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/prop/route')
    const res = await callRoute(DELETE as never, {
      path: `/api/novel-promotion/${PROJECT}/prop?id=foreign`,
      method: 'DELETE',
      query: { id: 'foreign' },
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionProp.delete).not.toHaveBeenCalled()
  })

  it('happy path deletes', async () => {
    prismaMock.novelPromotionProp.findFirst.mockResolvedValueOnce({ id: 'pp-1' })

    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/prop/route')
    const res = await callRoute(DELETE as never, {
      path: `/api/novel-promotion/${PROJECT}/prop?id=pp-1`,
      method: 'DELETE',
      query: { id: 'pp-1' },
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(200)
    expect(prismaMock.novelPromotionProp.delete).toHaveBeenCalledWith({ where: { id: 'pp-1' } })
  })
})
