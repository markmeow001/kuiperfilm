import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

// 局部重绘 (2026-07-17) — maskImage contract at the submission boundary:
// image-only, needs a source plate in referenceImages, model must declare
// supportMaskEdit in the capability catalog (REAL catalog json, not mocked —
// the test doubles as a registration check for atlascloud/gpt-image-1),
// and the mask key goes through the same reference guard as other refs.

const prismaMock = vi.hoisted(() => ({
  workspaceMember: { findFirst: vi.fn(async (..._args: unknown[]) => null) },
  workspace: { findFirst: vi.fn(async (..._args: unknown[]) => null) },
}))

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelection: vi.fn(async (_userId: string, modelKey: string, mediaType: string) => ({
    provider: 'atlascloud',
    modelId: modelKey.split('::')[1] || modelKey,
    modelKey,
    mediaType,
  })),
}))

const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-1',
    runId: 'run-1',
    status: 'queued',
    deduped: false,
  })),
}))

const guardMock = vi.hoisted(() => ({
  filterAuthorizedReferences: vi.fn(async (refs: string[]) => ({ safe: refs, rejected: [] as string[] })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)
vi.mock('@/lib/playground/reference-guard', () => guardMock)

const PLATE_KEY = 'images/playground-ref/user-1/plate.png'
const MASK_KEY = 'images/playground-ref/user-1/mask.png'

describe('POST /api/playground/run — maskImage (局部重绘) contract', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    guardMock.filterAuthorizedReferences.mockImplementation(
      async (refs: string[]) => ({ safe: refs, rejected: [] }),
    )
  })

  async function loadRoute() {
    return await import('@/app/api/playground/run/route')
  }

  function maskBody(overrides: Record<string, unknown> = {}) {
    return {
      prompt: '把背景换成雨夜霓虹街道',
      outputType: 'image',
      modelKey: 'atlascloud::gpt-image-1',
      referenceImages: [PLATE_KEY],
      maskImage: MASK_KEY,
      ...overrides,
    }
  }

  it('mask + plate + supportMaskEdit model → 200, payload carries maskImage', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({ path: '/api/playground/run', method: 'POST', body: maskBody() })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(submitterMock.submitTask).toHaveBeenCalledOnce()
    const arg = submitterMock.submitTask.mock.calls[0]?.[0] as Record<string, unknown>
    const payload = arg.payload as Record<string, unknown>
    expect(payload.maskImage).toBe(MASK_KEY)
    expect(payload.referenceImages).toEqual([PLATE_KEY])
  })

  it('mask on video output → 400 MASK_IMAGE_OUTPUT_TYPE', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: maskBody({ outputType: 'video', modelKey: 'atlascloud::seedance-2.0', durationSec: 5 }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.details.code).toBe('MASK_IMAGE_OUTPUT_TYPE')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('mask without a source plate → 400 MASK_IMAGE_NEEDS_SOURCE', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: maskBody({ referenceImages: [] }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.details.code).toBe('MASK_IMAGE_NEEDS_SOURCE')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('mask on a model without supportMaskEdit in the REAL catalog → 400 MASK_MODEL_UNSUPPORTED', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: maskBody({ modelKey: 'atlascloud::nano-banana-pro' }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.details.code).toBe('MASK_MODEL_UNSUPPORTED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('guard-rejected mask key → 403 REFERENCE_NOT_ALLOWED', async () => {
    guardMock.filterAuthorizedReferences.mockImplementation(async (refs: string[]) => {
      // Plate passes, mask (foreign key) is rejected.
      if (refs.includes(MASK_KEY)) return { safe: [], rejected: refs }
      return { safe: refs, rejected: [] }
    })
    const { POST } = await loadRoute()
    const req = buildMockRequest({ path: '/api/playground/run', method: 'POST', body: maskBody() })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error.details.code).toBe('REFERENCE_NOT_ALLOWED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('no mask → payload has no maskImage key (unchanged spine)', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: maskBody({ maskImage: undefined }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const arg = submitterMock.submitTask.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.payload).not.toHaveProperty('maskImage')
  })
})
