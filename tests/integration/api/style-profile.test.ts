import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockProjectAuth,
  mockUnauthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

// ===== Mocks =====

type ProjectRow = {
  id: string
  userId: string
  novelPromotionData: {
    id: string
    stylePositivePrompt: string | null
    styleNegativePrompt: string | null
    styleReferenceImages: string | null
    stylePresetKey?: string | null
    visualStyleId?: string | null
    lightingPresetId?: string | null
  } | null
}

type MediaRow = {
  id: string
  publicId: string
  storageKey: string
  ownerUserId?: string | null
}

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn<(...args: unknown[]) => Promise<ProjectRow | null>>(),
  },
  novelPromotionProject: {
    findUnique: vi.fn<(...args: unknown[]) => Promise<ProjectRow['novelPromotionData']>>(),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  mediaObject: {
    findMany: vi.fn<(...args: unknown[]) => Promise<MediaRow[]>>(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('api PATCH /api/projects/[projectId]/style-profile', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
  })

  async function loadRoute() {
    return await import('@/app/api/projects/[projectId]/style-profile/route')
  }

  function buildContext(projectId = 'project-1') {
    return { params: Promise.resolve({ projectId }) }
  }

  // 合法 UUID v4 fixture（route Zod schema 强制 UUID 格式 8-4-4-4-12）
  const VALID_MEDIA_ID_OWN = '11111111-1111-4111-8111-111111111111'
  const VALID_MEDIA_ID_OTHER = '22222222-2222-4222-8222-222222222222'

  it('valid 三栏 -> 200 + DB 三栏被更新', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('allow')

    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: null,
    })
    // Q-005 A: MediaObject 已加 uploadedByUserId 欄位，由 user-1 上傳 → 验证通过
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([
      {
        id: VALID_MEDIA_ID_OWN,
        publicId: 'pub-1',
        storageKey: 'cos/r.png',
        ownerUserId: 'user-1',
      },
    ])

    const route = await loadRoute()

    const req = buildMockRequest({
      path: '/api/projects/project-1/style-profile',
      method: 'PATCH',
      body: {
        stylePositivePrompt: 'POSITIVE',
        styleNegativePrompt: 'NEGATIVE',
        styleReferenceImages: [VALID_MEDIA_ID_OWN],
      },
    })

    const res = await route.PATCH(req, buildContext())
    expect(res.status).toBe(200)

    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledTimes(1)
    const updateCall = prismaMock.novelPromotionProject.update.mock.calls[0]?.[0] as {
      where: { id?: string; projectId?: string }
      data: {
        stylePositivePrompt: string | null
        styleNegativePrompt: string | null
        styleReferenceImages: string | null
      }
    }
    expect(updateCall.data.stylePositivePrompt).toBe('POSITIVE')
    expect(updateCall.data.styleNegativePrompt).toBe('NEGATIVE')
    // styleReferenceImages 应被序列化为 JSON 字符串
    expect(typeof updateCall.data.styleReferenceImages).toBe('string')
    const parsedRefs = JSON.parse(updateCall.data.styleReferenceImages as string) as unknown
    expect(Array.isArray(parsedRefs)).toBe(true)
    expect(parsedRefs).toEqual([VALID_MEDIA_ID_OWN])
  })

  it('越权 mediaId（其他 user 上傳）-> 403 拒绝写入', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('allow')

    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: null,
    })
    // Q-005 A: 合法 UUID + uploadedByUserId 是 'user-2'（非 currentUser）。
    // route 的 assertReferenceImagesOwned 会用 ownerUserId 过滤后发现 size 不匹配 -> 403。
    // 实现细节：implementer 第二轮在 route 内的 findMany 加 where: { uploadedByUserId: session.user.id }
    // → 当其他 user 上传的 media 被引用时 findMany 回传 [] 或少于 input → throw 403。
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([])

    const route = await loadRoute()

    const req = buildMockRequest({
      path: '/api/projects/project-1/style-profile',
      method: 'PATCH',
      body: {
        stylePositivePrompt: null,
        styleNegativePrompt: null,
        styleReferenceImages: [VALID_MEDIA_ID_OTHER],
      },
    })

    const res = await route.PATCH(req, buildContext())
    expect(res.status).toBe(403)
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()

    // 业务断言：findMany 调用时必须包含 owner 过滤的 where 子句
    // implementer 第二轮在 assertReferenceImagesOwned 加 uploadedByUserId where 过滤
    const findManyCalls = prismaMock.mediaObject.findMany.mock.calls
    expect(findManyCalls.length).toBeGreaterThan(0)
    const callArg = findManyCalls[0]?.[0] as { where?: Record<string, unknown> } | undefined
    expect(callArg?.where).toEqual(
      expect.objectContaining({
        uploadedByUserId: 'user-1',
      }),
    )
  })

  it('stylePositivePrompt 超过 8000 chars -> 400', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('allow')

    const route = await loadRoute()

    const tooLong = 'A'.repeat(8001)

    const req = buildMockRequest({
      path: '/api/projects/project-1/style-profile',
      method: 'PATCH',
      body: {
        stylePositivePrompt: tooLong,
        styleNegativePrompt: null,
        styleReferenceImages: null,
      },
    })

    const res = await route.PATCH(req, buildContext())
    expect(res.status).toBe(400)
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('三栏全 null（清除）-> 200 + DB 三栏都变 null', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('allow')

    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-1',
      stylePositivePrompt: 'OLD',
      styleNegativePrompt: 'OLD_NEG',
      styleReferenceImages: JSON.stringify(['media-old']),
    })

    const route = await loadRoute()

    const req = buildMockRequest({
      path: '/api/projects/project-1/style-profile',
      method: 'PATCH',
      body: {
        stylePositivePrompt: null,
        styleNegativePrompt: null,
        styleReferenceImages: null,
      },
    })

    const res = await route.PATCH(req, buildContext())
    expect(res.status).toBe(200)

    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledTimes(1)
    const updateData = prismaMock.novelPromotionProject.update.mock.calls[0]?.[0] as {
      data: {
        stylePositivePrompt: string | null
        styleNegativePrompt: string | null
        styleReferenceImages: string | null
      }
    }
    expect(updateData.data.stylePositivePrompt).toBeNull()
    expect(updateData.data.styleNegativePrompt).toBeNull()
    expect(updateData.data.styleReferenceImages).toBeNull()
  })

  it('未登录 -> 401', async () => {
    installAuthMocks()
    mockUnauthenticated()

    const route = await loadRoute()

    const req = buildMockRequest({
      path: '/api/projects/project-1/style-profile',
      method: 'PATCH',
      body: {
        stylePositivePrompt: 'X',
      },
    })

    const res = await route.PATCH(req, buildContext())
    expect(res.status).toBe(401)
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('不拥有此 project -> 404 或 403', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('forbidden')

    const route = await loadRoute()

    const req = buildMockRequest({
      path: '/api/projects/project-not-mine/style-profile',
      method: 'PATCH',
      body: { stylePositivePrompt: 'X' },
    })

    const res = await route.PATCH(req, buildContext('project-not-mine'))
    expect([403, 404]).toContain(res.status)
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('project 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('not_found')

    const route = await loadRoute()

    const req = buildMockRequest({
      path: '/api/projects/project-x/style-profile',
      method: 'PATCH',
      body: { stylePositivePrompt: 'X' },
    })

    const res = await route.PATCH(req, buildContext('project-x'))
    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('styleNegativePrompt 超过 8000 chars -> 400', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('allow')

    const route = await loadRoute()

    const req = buildMockRequest({
      path: '/api/projects/project-1/style-profile',
      method: 'PATCH',
      body: {
        stylePositivePrompt: null,
        styleNegativePrompt: 'B'.repeat(8001),
        styleReferenceImages: null,
      },
    })

    const res = await route.PATCH(req, buildContext())
    expect(res.status).toBe(400)
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })
})

// =====================================================================
// Q-008 A: GET /api/projects/[projectId]/style-profile —— 用于 panel prefill
// implementer 第二轮新增 GET handler。
// =====================================================================

describe('api GET /api/projects/[projectId]/style-profile', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
  })

  async function loadRoute() {
    return await import('@/app/api/projects/[projectId]/style-profile/route')
  }

  function buildContext(projectId = 'project-1') {
    return { params: Promise.resolve({ projectId }) }
  }

  it('已登录 + 拥有 project + 有完整三栏 -> 200 + body 含三栏 + styleReferenceImages 被 parse 成 array', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('allow')

    const VALID_ID = '11111111-1111-4111-8111-111111111111'
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-1',
      stylePositivePrompt: 'POS_LOADED',
      styleNegativePrompt: 'NEG_LOADED',
      styleReferenceImages: JSON.stringify([VALID_ID]),
    })

    const route = await loadRoute()
    if (typeof route.GET !== 'function') {
      throw new Error('GET handler not exported yet — implementer 第二轮 Q-008 新增')
    }

    const req = buildMockRequest({
      path: '/api/projects/project-1/style-profile',
      method: 'GET',
    })

    const res = await route.GET(req, buildContext())
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      success?: boolean
      data?: {
        stylePositivePrompt: string | null
        styleNegativePrompt: string | null
        styleReferenceImages: string[] | null
      }
    }
    expect(body.success).toBe(true)
    expect(body.data?.stylePositivePrompt).toBe('POS_LOADED')
    expect(body.data?.styleNegativePrompt).toBe('NEG_LOADED')
    // 关键：styleReferenceImages 必须 parse 成 array 而不是 JSON string
    expect(Array.isArray(body.data?.styleReferenceImages)).toBe(true)
    expect(body.data?.styleReferenceImages).toEqual([VALID_ID])
  })

  it('已登录 + 拥有 project + 三栏全 null -> 200 + body 三栏皆为 null', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('allow')

    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImages: null,
    })

    const route = await loadRoute()
    if (typeof route.GET !== 'function') {
      throw new Error('GET handler not exported yet — implementer 第二轮 Q-008 新增')
    }

    const req = buildMockRequest({
      path: '/api/projects/project-1/style-profile',
      method: 'GET',
    })
    const res = await route.GET(req, buildContext())
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      data?: {
        stylePositivePrompt: string | null
        styleNegativePrompt: string | null
        styleReferenceImages: string[] | null
      }
    }
    expect(body.data?.stylePositivePrompt).toBeNull()
    expect(body.data?.styleNegativePrompt).toBeNull()
    // styleReferenceImages 三态：null（未设过） vs []（清空过） vs [...]（有内容）
    expect(body.data?.styleReferenceImages === null || (Array.isArray(body.data?.styleReferenceImages) && body.data?.styleReferenceImages.length === 0)).toBe(true)
  })

  it('未登录 -> 401', async () => {
    installAuthMocks()
    mockUnauthenticated()

    const route = await loadRoute()
    if (typeof route.GET !== 'function') {
      throw new Error('GET handler not exported yet — implementer 第二轮 Q-008 新增')
    }

    const req = buildMockRequest({
      path: '/api/projects/project-1/style-profile',
      method: 'GET',
    })

    const res = await route.GET(req, buildContext())
    expect(res.status).toBe(401)
    expect(prismaMock.novelPromotionProject.findUnique).not.toHaveBeenCalled()
  })

  it('不拥有此 project -> 403 / 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('forbidden')

    const route = await loadRoute()
    if (typeof route.GET !== 'function') {
      throw new Error('GET handler not exported yet — implementer 第二轮 Q-008 新增')
    }

    const req = buildMockRequest({
      path: '/api/projects/project-not-mine/style-profile',
      method: 'GET',
    })

    const res = await route.GET(req, buildContext('project-not-mine'))
    expect([403, 404]).toContain(res.status)
  })

  it('project 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    mockProjectAuth('not_found')

    const route = await loadRoute()
    if (typeof route.GET !== 'function') {
      throw new Error('GET handler not exported yet — implementer 第二轮 Q-008 新增')
    }

    const req = buildMockRequest({
      path: '/api/projects/project-x/style-profile',
      method: 'GET',
    })

    const res = await route.GET(req, buildContext('project-x'))
    expect(res.status).toBe(404)
  })

  // ─────────────────────────────────────────────────────────────────────
  // Phase B (2026-05-13) — visualStyleId / lightingPresetId picker fields
  // ─────────────────────────────────────────────────────────────────────

  describe('Phase B visualStyleId / lightingPresetId', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.clearAllMocks()
      resetAuthMockState()
    })

    it('PATCH writes visualStyleId + lightingPresetId to DB', async () => {
      installAuthMocks()
      mockAuthenticated('user-1')
      mockProjectAuth('allow')

      prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
        id: 'np-1',
        stylePositivePrompt: null,
        styleNegativePrompt: null,
        styleReferenceImages: null,
      })
      prismaMock.novelPromotionProject.update.mockResolvedValueOnce({
        id: 'np-1',
        stylePositivePrompt: null,
        styleNegativePrompt: null,
        styleReferenceImages: null,
        stylePresetKey: null,
        visualStyleId: 'cinematic_realism',
        lightingPresetId: 'golden_hour',
      })

      const route = await loadRoute()
      const req = buildMockRequest({
        path: '/api/projects/project-1/style-profile',
        method: 'PATCH',
        body: { visualStyleId: 'cinematic_realism', lightingPresetId: 'golden_hour' },
      })

      const res = await route.PATCH(req, buildContext('project-1'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { visualStyleId: string | null; lightingPresetId: string | null } }
      expect(body.data.visualStyleId).toBe('cinematic_realism')
      expect(body.data.lightingPresetId).toBe('golden_hour')
      expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visualStyleId: 'cinematic_realism',
            lightingPresetId: 'golden_hour',
          }),
        }),
      )
    })

    it('PATCH visualStyleId: null clears the column', async () => {
      installAuthMocks()
      mockAuthenticated('user-1')
      mockProjectAuth('allow')

      prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
        id: 'np-1',
        stylePositivePrompt: null,
        styleNegativePrompt: null,
        styleReferenceImages: null,
      })
      prismaMock.novelPromotionProject.update.mockResolvedValueOnce({
        id: 'np-1',
        stylePositivePrompt: null,
        styleNegativePrompt: null,
        styleReferenceImages: null,
        stylePresetKey: null,
        visualStyleId: null,
        lightingPresetId: null,
      })

      const route = await loadRoute()
      const req = buildMockRequest({
        path: '/api/projects/project-1/style-profile',
        method: 'PATCH',
        body: { visualStyleId: null },
      })

      const res = await route.PATCH(req, buildContext('project-1'))
      expect(res.status).toBe(200)
      expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ visualStyleId: null }),
        }),
      )
    })

    it('PATCH visualStyleId > 64 chars -> 400', async () => {
      installAuthMocks()
      mockAuthenticated('user-1')
      mockProjectAuth('allow')

      const route = await loadRoute()
      const req = buildMockRequest({
        path: '/api/projects/project-1/style-profile',
        method: 'PATCH',
        body: { visualStyleId: 'x'.repeat(65) },
      })

      const res = await route.PATCH(req, buildContext('project-1'))
      expect(res.status).toBe(400)
    })

    it('GET returns visualStyleId + lightingPresetId in response', async () => {
      installAuthMocks()
      mockAuthenticated('user-1')
      mockProjectAuth('allow')

      prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
        id: 'np-1',
        stylePositivePrompt: null,
        styleNegativePrompt: null,
        styleReferenceImages: null,
        stylePresetKey: null,
        visualStyleId: 'cinematic_realism',
        lightingPresetId: null,
      })

      const route = await loadRoute()
      const req = buildMockRequest({
        path: '/api/projects/project-1/style-profile',
        method: 'GET',
      })

      const res = await route.GET(req, buildContext('project-1'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { visualStyleId: string | null; lightingPresetId: string | null } }
      expect(body.data.visualStyleId).toBe('cinematic_realism')
      expect(body.data.lightingPresetId).toBeNull()
    })
  })
})
