import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

// Covers PR-A1's new modelKey enabled-list + type-match gate at the
// Playground submission boundary. Before this gate, any string passed
// modelKey validation and reached the worker, which could either fall
// back to admin's keys (silent cross-account billing) or fail deep in
// the generator with a confusing provider message.

const prismaMock = vi.hoisted(() => ({
  workspaceMember: {
    findFirst: vi.fn(async (..._args: unknown[]) => null),
  },
  workspace: {
    findFirst: vi.fn(async (..._args: unknown[]) => null),
  },
  playgroundRun: {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'run-1',
      ...args.data,
      createdAt: new Date('2026-06-12T00:00:00Z'),
      status: args.data.status,
      outputType: args.data.outputType,
      modelKey: args.data.modelKey,
    })),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
}))

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelection: vi.fn(async (_userId: string, modelKey: string, mediaType: string) => {
    // Default: pretend modelKey is enabled and type matches.
    return {
      provider: 'atlascloud',
      modelId: modelKey.split('::')[1] || modelKey,
      modelKey,
      mediaType,
    }
  }),
}))

const enqueueMock = vi.hoisted(() => ({
  enqueuePlaygroundImageJob: vi.fn(async () => ({ jobId: 'job-1' })),
  enqueuePlaygroundVideoJob: vi.fn(async () => ({ jobId: 'job-1' })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/playground/enqueue', () => enqueueMock)

describe('POST /api/playground/run — modelKey enablement gate (PR-A1)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    // Reset default mock impls clobbered by clearAllMocks.
    apiConfigMock.resolveModelSelection.mockImplementation(
      async (_userId: string, modelKey: string, mediaType: string) => ({
        provider: 'atlascloud',
        modelId: modelKey.split('::')[1] || modelKey,
        modelKey,
        mediaType,
      }),
    )
    enqueueMock.enqueuePlaygroundImageJob.mockResolvedValue({ jobId: 'job-1' })
    enqueueMock.enqueuePlaygroundVideoJob.mockResolvedValue({ jobId: 'job-1' })
  })

  async function loadRoute() {
    return await import('@/app/api/playground/run/route')
  }

  it('disabled modelKey → 403 MODEL_NOT_ENABLED + no DB row created', async () => {
    apiConfigMock.resolveModelSelection.mockRejectedValueOnce(
      new Error('MODEL_NOT_FOUND: openai::dall-e-3 is not enabled for image'),
    )

    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: {
        prompt: 'a red cube',
        outputType: 'image',
        modelKey: 'openai::dall-e-3',
      },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error.code).toBe('FORBIDDEN')
    expect(json.error.details.code).toBe('MODEL_NOT_ENABLED')
    // Inner details payload (file convention nests under details.details).
    expect(json.error.details.details.modelKey).toBe('openai::dall-e-3')
    expect(json.error.details.details.outputType).toBe('image')
    // Critical: no PlaygroundRun row leaked through the boundary.
    expect(prismaMock.playgroundRun.create).not.toHaveBeenCalled()
    expect(enqueueMock.enqueuePlaygroundImageJob).not.toHaveBeenCalled()
  })

  it('outputType=image but model is video-only → 403 MODEL_NOT_ENABLED', async () => {
    // Simulates a video modelKey being submitted under outputType=image —
    // resolveModelSelection throws because mediaType filter rejects it.
    apiConfigMock.resolveModelSelection.mockRejectedValueOnce(
      new Error('MODEL_NOT_FOUND: atlascloud::seedance-2.0 is not enabled for image'),
    )

    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: {
        prompt: 'horse running',
        outputType: 'image',
        modelKey: 'atlascloud::seedance-2.0',
      },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error.code).toBe('FORBIDDEN')
    expect(json.error.details.code).toBe('MODEL_NOT_ENABLED')
    expect(prismaMock.playgroundRun.create).not.toHaveBeenCalled()
  })

  it('enabled image modelKey → 200 + row created + image enqueue called', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: {
        prompt: 'a sunset',
        outputType: 'image',
        modelKey: 'atlascloud::nano-banana-pro',
      },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.run.modelKey).toBe('atlascloud::nano-banana-pro')
    expect(prismaMock.playgroundRun.create).toHaveBeenCalledOnce()
    expect(enqueueMock.enqueuePlaygroundImageJob).toHaveBeenCalledOnce()
    expect(enqueueMock.enqueuePlaygroundVideoJob).not.toHaveBeenCalled()
  })

  it('enabled video modelKey → 200 + video enqueue called', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: {
        prompt: 'horse running across plains',
        outputType: 'video',
        modelKey: 'atlascloud::seedance-2.0',
      },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(prismaMock.playgroundRun.create).toHaveBeenCalledOnce()
    expect(enqueueMock.enqueuePlaygroundVideoJob).toHaveBeenCalledOnce()
    expect(enqueueMock.enqueuePlaygroundImageJob).not.toHaveBeenCalled()
  })

  it('malformed JSON body → 400 INVALID_JSON_BODY (not silent {} coercion)', async () => {
    const { POST } = await loadRoute()
    // NextRequest with broken JSON body — exercises the explicit
    // try/catch that PR-A1 added to replace `.catch(() => ({}))`.
    const req = new NextRequest('http://localhost:3000/api/playground/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_PARAMS')
    expect(json.error.details.code).toBe('INVALID_JSON_BODY')
    expect(prismaMock.playgroundRun.create).not.toHaveBeenCalled()
  })

  it('modelKey gets trimmed before being written to DB row', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: {
        prompt: 'a tree',
        outputType: 'image',
        modelKey: '  atlascloud::nano-banana-pro  ',
      },
    })

    await POST(req, { params: Promise.resolve({}) })
    expect(apiConfigMock.resolveModelSelection).toHaveBeenCalledWith(
      'user-1',
      'atlascloud::nano-banana-pro',
      'image',
    )
    const createArgs = prismaMock.playgroundRun.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(createArgs.data.modelKey).toBe('atlascloud::nano-banana-pro')
  })
})
