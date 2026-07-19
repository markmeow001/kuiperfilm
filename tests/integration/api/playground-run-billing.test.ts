import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'
import { ApiError } from '@/lib/api-errors'

// Phase 9.1 — billing (quote → freeze → 402 / enqueue rollback) is no longer
// route logic; it lives inside submitTask (covered by its own tests). This
// file now only verifies the ROUTE correctly threads billing-relevant params
// into submitTask and surfaces submitTask's INSUFFICIENT_BALANCE as 402.

const prismaMock = vi.hoisted(() => ({
  workspaceMember: { findFirst: vi.fn(async (..._args: unknown[]) => null) },
  workspace: { findFirst: vi.fn(async (..._args: unknown[]) => null) },
}))

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelection: vi.fn(async (_userId: string, modelKey: string, mediaType: string) => ({
    provider: modelKey.split('::')[0] || 'atlascloud',
    modelId: modelKey.split('::')[1] || modelKey,
    modelKey,
    mediaType,
  })),
}))

const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn<(arg: Record<string, unknown>) => Promise<{
    success: boolean
    async: boolean
    taskId: string
    runId: string
    status: string
    deduped: boolean
  }>>(async () => ({
    success: true,
    async: true,
    taskId: 'task-1',
    runId: 'run-1',
    status: 'queued',
    deduped: false,
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)

describe('POST /api/playground/run — billing passthrough (Phase 9.1 spine)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    apiConfigMock.resolveModelSelection.mockImplementation(
      async (_userId: string, modelKey: string, mediaType: string) => ({
        provider: modelKey.split('::')[0] || 'atlascloud',
        modelId: modelKey.split('::')[1] || modelKey,
        modelKey,
        mediaType,
      }),
    )
    submitterMock.submitTask.mockResolvedValue({
      success: true,
      async: true,
      taskId: 'task-1',
      runId: 'run-1',
      status: 'queued',
      deduped: false,
    })
  })

  async function loadRoute() {
    return await import('@/app/api/playground/run/route')
  }

  function postBody(overrides?: Record<string, unknown>) {
    return {
      prompt: 'a sunset',
      outputType: 'image',
      modelKey: 'atlascloud::nano-banana-pro',
      ...overrides,
    }
  }

  it('happy path → submitTask called once, 200', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({ path: '/api/playground/run', method: 'POST', body: postBody() })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(submitterMock.submitTask).toHaveBeenCalledOnce()
  })

  it('submitTask throws INSUFFICIENT_BALANCE → route surfaces 402', async () => {
    submitterMock.submitTask.mockRejectedValueOnce(
      new ApiError('INSUFFICIENT_BALANCE', { message: '余额不足', required: 0.5 }),
    )

    const { POST } = await loadRoute()
    const req = buildMockRequest({ path: '/api/playground/run', method: 'POST', body: postBody() })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(402)
    const json = await res.json()
    expect(json.error.code).toBe('INSUFFICIENT_BALANCE')
  })

  it('video outputType → payload carries duration + resolution + modelId for billing', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: postBody({
        outputType: 'video',
        modelKey: 'atlascloud::seedance-2.0',
        durationSec: 8,
        resolution: '1080p',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const arg = submitterMock.submitTask.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.type).toBe('playground_video')
    const payload = arg.payload as Record<string, unknown>
    expect(payload.duration).toBe(8)
    expect(payload.resolution).toBe('1080p')
    expect(payload.modelId).toBe('seedance-2.0')
  })

  it('preserveSourceAudio requires exactly one reference video', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: postBody({
        outputType: 'video',
        modelKey: 'atlascloud::seedance-2.0-r2v',
        preserveSourceAudio: true,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_PARAMS')
    expect(json.error.details.code).toBe('PRESERVE_SOURCE_AUDIO_REQUIRES_VIDEO')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })
})
