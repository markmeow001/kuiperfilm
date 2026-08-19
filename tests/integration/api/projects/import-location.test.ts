import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockUnauthenticated,
  resetAuthMockState,
} from '../../../helpers/auth'

/**
 * Phase 11.2 — POST /api/projects/[projectId]/import-location
 *
 * 從資產中心 (GlobalLocation) 匯入場景到一個 project：
 *   - 複製 GlobalLocation -> NovelPromotionLocation（記錄 sourceGlobalLocationId）
 *   - includeImages 預設 true：複製 GlobalLocationImage -> LocationImage
 *   - includeImages=false：只複製主 location
 *
 * 合約：
 *   - 200 / 400 / 401 / 403 / 404 同 import-character pattern
 *
 * Note: body 字段是 includeImages（不是 includeAppearances）
 */

const txMock = vi.hoisted(() => ({
  novelPromotionLocation: {
    create: vi.fn(),
  },
  locationImage: {
    createMany: vi.fn(),
  },
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  globalLocation: {
    findUnique: vi.fn(),
  },
  novelPromotionLocation: {
    findUnique: vi.fn(),
  },
  mediaObject: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('POST /api/projects/[projectId]/import-location', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()

    prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-1', userId: 'user-a' })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'np-1' })
    prismaMock.mediaObject.findMany.mockResolvedValue([])
    prismaMock.mediaObject.findUnique.mockResolvedValue(null)

    txMock.novelPromotionLocation.create.mockResolvedValue({ id: 'npl-1' })
    txMock.locationImage.createMany.mockResolvedValue({ count: 0 })

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
    )
  })

  it('未登入 -> 401', async () => {
    installAuthMocks()
    mockUnauthenticated()

    const mod = await import('@/app/api/projects/[projectId]/import-location/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-location',
      method: 'POST',
      body: { globalLocationId: 'gl-1' },
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(401)
    expect(txMock.novelPromotionLocation.create).not.toHaveBeenCalled()
  })

  it('project 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.project.findUnique.mockResolvedValue(null)

    const mod = await import('@/app/api/projects/[projectId]/import-location/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-404/import-location',
      method: 'POST',
      body: { globalLocationId: 'gl-1' },
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-404' }) })
    expect(res.status).toBe(404)
    expect(txMock.novelPromotionLocation.create).not.toHaveBeenCalled()
  })

  it('不擁有此 project -> 403', async () => {
    installAuthMocks()
    mockAuthenticated('user-b')
    prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-1', userId: 'user-a' })

    const mod = await import('@/app/api/projects/[projectId]/import-location/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-location',
      method: 'POST',
      body: { globalLocationId: 'gl-1' },
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(403)
    expect(txMock.novelPromotionLocation.create).not.toHaveBeenCalled()
  })

  it('缺 globalLocationId -> 400', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    const mod = await import('@/app/api/projects/[projectId]/import-location/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-location',
      method: 'POST',
      body: {},
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(400)
    expect(txMock.novelPromotionLocation.create).not.toHaveBeenCalled()
  })

  it('GlobalLocation 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.globalLocation.findUnique.mockResolvedValue(null)

    const mod = await import('@/app/api/projects/[projectId]/import-location/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-location',
      method: 'POST',
      body: { globalLocationId: 'gl-missing' },
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(404)
    expect(txMock.novelPromotionLocation.create).not.toHaveBeenCalled()
  })

  it('別人的 GlobalLocation -> 403, 不寫入', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.globalLocation.findUnique.mockResolvedValue({
      id: 'gl-1',
      userId: 'user-b',
      name: 'Hidden Lab',
      summary: null,
      images: [],
    })

    const mod = await import('@/app/api/projects/[projectId]/import-location/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-location',
      method: 'POST',
      body: { globalLocationId: 'gl-1' },
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(403)
    expect(txMock.novelPromotionLocation.create).not.toHaveBeenCalled()
  })

  it('[location image JSON contains a reserved VoiceLine output] -> [400 before transaction/copy]', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.globalLocation.findUnique.mockResolvedValue({
      id: 'gl-reserved',
      userId: 'user-a',
      name: 'Unsafe location',
      summary: null,
      images: [{
        imageUrl: JSON.stringify([
          `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`,
        ]),
        imageMediaId: null,
      }],
    })

    const mod = await import('@/app/api/projects/[projectId]/import-location/route')
    const res = await mod.POST(buildMockRequest({
      path: '/api/projects/proj-1/import-location',
      method: 'POST',
      body: { globalLocationId: 'gl-reserved' },
    }), { params: Promise.resolve({ projectId: 'proj-1' }) })

    expect(res.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('成功 + includeImages 預設 true -> 200, 寫入 NovelPromotionLocation + 2 個 LocationImage, sourceGlobalLocationId 對', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    prismaMock.globalLocation.findUnique.mockResolvedValue({
      id: 'gl-1',
      userId: 'user-a',
      name: '客廳',
      summary: '主角的家',
      images: [
        {
          id: 'gli-1',
          imageIndex: 0,
          description: '日',
          imageUrl: 'https://cdn/loc-0.png',
          imageMediaId: 'm-0',
          isSelected: true,
          previousImageUrl: null,
          previousDescription: null,
        },
        {
          id: 'gli-2',
          imageIndex: 1,
          description: '夜',
          imageUrl: 'https://cdn/loc-1.png',
          imageMediaId: 'm-1',
          isSelected: false,
          previousImageUrl: null,
          previousDescription: null,
        },
      ],
    })
    txMock.novelPromotionLocation.create.mockResolvedValue({ id: 'npl-1' })
    prismaMock.novelPromotionLocation.findUnique.mockResolvedValue({
      id: 'npl-1',
      name: '客廳',
      sourceGlobalLocationId: 'gl-1',
      images: [{ id: 'li-1' }, { id: 'li-2' }],
    })

    const mod = await import('@/app/api/projects/[projectId]/import-location/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-location',
      method: 'POST',
      body: { globalLocationId: 'gl-1' }, // 預設 includeImages
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(200)

    expect(txMock.novelPromotionLocation.create).toHaveBeenCalledTimes(1)
    const arg = txMock.novelPromotionLocation.create.mock.calls[0][0]
    expect(arg.data).toEqual(expect.objectContaining({
      novelPromotionProjectId: 'np-1',
      name: '客廳',
      summary: '主角的家',
      sourceGlobalLocationId: 'gl-1',
    }))

    // createMany 寫入 2 張 image
    expect(txMock.locationImage.createMany).toHaveBeenCalledTimes(1)
    const liArg = txMock.locationImage.createMany.mock.calls[0][0]
    expect(liArg.data).toHaveLength(2)
    expect(liArg.data[0]).toEqual(expect.objectContaining({
      locationId: 'npl-1',
      imageIndex: 0,
      description: '日',
      imageUrl: 'https://cdn/loc-0.png',
      isSelected: true,
    }))
    expect(liArg.data[1]).toEqual(expect.objectContaining({
      locationId: 'npl-1',
      imageIndex: 1,
      description: '夜',
      isSelected: false,
    }))

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.location.sourceGlobalLocationId).toBe('gl-1')
  })

  it('includeImages=false -> 200, 只創建 location, 不複製 image', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    prismaMock.globalLocation.findUnique.mockResolvedValue({
      id: 'gl-2',
      userId: 'user-a',
      name: '街道',
      summary: null,
      images: [
        {
          id: 'gli-x',
          imageIndex: 0,
          description: null,
          imageUrl: null,
          imageMediaId: null,
          isSelected: false,
          previousImageUrl: null,
          previousDescription: null,
        },
      ],
    })
    txMock.novelPromotionLocation.create.mockResolvedValue({ id: 'npl-2' })
    prismaMock.novelPromotionLocation.findUnique.mockResolvedValue({
      id: 'npl-2',
      name: '街道',
      sourceGlobalLocationId: 'gl-2',
      images: [],
    })

    const mod = await import('@/app/api/projects/[projectId]/import-location/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-location',
      method: 'POST',
      body: { globalLocationId: 'gl-2', includeImages: false },
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(200)

    expect(txMock.novelPromotionLocation.create).toHaveBeenCalledTimes(1)
    expect(txMock.locationImage.createMany).not.toHaveBeenCalled()
  })
})
