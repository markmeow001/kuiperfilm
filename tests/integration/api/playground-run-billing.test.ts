import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

// Covers PR-A2's freeze → row → enqueue → refund-on-enqueue-fail flow at
// the Playground submission boundary. The worker-side capture/refund is
// covered indirectly here (the route hands off freezeId on the row) and
// the helper itself is unit-tested via the route's behavior under mocked
// freezeForPlayground/refundForPlayground.

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
      freezeId: null,
    })),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
}))

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelection: vi.fn(async (_userId: string, modelKey: string, mediaType: string) => ({
    provider: modelKey.split('::')[0] || 'atlascloud',
    modelId: modelKey.split('::')[1] || modelKey,
    modelKey,
    mediaType,
  })),
}))

const billingMock = vi.hoisted(() => ({
  quotePlaygroundCost: vi.fn<(...args: unknown[]) => Promise<{ quotedCost: number; pricingVersion: string }>>(),
  freezeForPlayground: vi.fn<(...args: unknown[]) => Promise<string | null>>(),
  refundForPlayground: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
  captureForPlayground: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
}))

const enqueueMock = vi.hoisted(() => ({
  enqueuePlaygroundImageJob: vi.fn(async () => ({ jobId: 'job-1' })),
  enqueuePlaygroundVideoJob: vi.fn(async () => ({ jobId: 'job-1' })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/playground/billing', () => billingMock)
vi.mock('@/lib/playground/enqueue', () => enqueueMock)

describe('POST /api/playground/run — billing freeze/refund (PR-A2)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    // Re-arm defaults that vi.clearAllMocks wiped.
    apiConfigMock.resolveModelSelection.mockImplementation(
      async (_userId: string, modelKey: string, mediaType: string) => ({
        provider: modelKey.split('::')[0] || 'atlascloud',
        modelId: modelKey.split('::')[1] || modelKey,
        modelKey,
        mediaType,
      }),
    )
    billingMock.quotePlaygroundCost.mockResolvedValue({ quotedCost: 0.5, pricingVersion: '2026-02-19' })
    billingMock.freezeForPlayground.mockResolvedValue('freeze-xyz')
    billingMock.refundForPlayground.mockResolvedValue(true)
    enqueueMock.enqueuePlaygroundImageJob.mockResolvedValue({ jobId: 'job-1' })
    enqueueMock.enqueuePlaygroundVideoJob.mockResolvedValue({ jobId: 'job-1' })
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

  it('happy path → freeze called, row stamped with freezeId, image enqueued', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({ path: '/api/playground/run', method: 'POST', body: postBody() })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(billingMock.quotePlaygroundCost).toHaveBeenCalledOnce()
    expect(billingMock.freezeForPlayground).toHaveBeenCalledOnce()
    // Row created with costEstimate + pricingVersion.
    const createArgs = prismaMock.playgroundRun.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(createArgs.data.costEstimate).toBe(0.5)
    expect(createArgs.data.pricingVersion).toBe('2026-02-19')
    // freezeId stamped via update after freeze succeeds.
    const stampUpdate = prismaMock.playgroundRun.update.mock.calls.find(
      (call) => (call[0] as { data?: { freezeId?: string } }).data?.freezeId === 'freeze-xyz',
    )
    expect(stampUpdate).toBeDefined()
    expect(enqueueMock.enqueuePlaygroundImageJob).toHaveBeenCalledOnce()
    // No refund on happy path.
    expect(billingMock.refundForPlayground).not.toHaveBeenCalled()
  })

  it('insufficient balance (freezeForPlayground returns null) → 402 + row marked failed + no enqueue', async () => {
    billingMock.freezeForPlayground.mockResolvedValueOnce(null)

    const { POST } = await loadRoute()
    const req = buildMockRequest({ path: '/api/playground/run', method: 'POST', body: postBody() })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(402) // INSUFFICIENT_BALANCE → 402
    const json = await res.json()
    expect(json.error.code).toBe('INSUFFICIENT_BALANCE')
    expect(json.error.details.required).toBe(0.5)
    // Row should still have been created (audit trail), then flipped failed.
    expect(prismaMock.playgroundRun.create).toHaveBeenCalledOnce()
    const failUpdate = prismaMock.playgroundRun.update.mock.calls.find(
      (call) => (call[0] as { data?: { status?: string } }).data?.status === 'failed',
    )
    expect(failUpdate).toBeDefined()
    expect((failUpdate?.[0] as { data?: { errorMessage?: string } }).data?.errorMessage).toBe('INSUFFICIENT_BALANCE')
    // No enqueue, no refund (freeze never happened).
    expect(enqueueMock.enqueuePlaygroundImageJob).not.toHaveBeenCalled()
    expect(billingMock.refundForPlayground).not.toHaveBeenCalled()
  })

  it('enqueue fails after freeze succeeds → row marked failed + REFUND called', async () => {
    enqueueMock.enqueuePlaygroundImageJob.mockRejectedValueOnce(new Error('Redis ECONNREFUSED'))

    const { POST } = await loadRoute()
    const req = buildMockRequest({ path: '/api/playground/run', method: 'POST', body: postBody() })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(502) // EXTERNAL_ERROR
    expect(billingMock.freezeForPlayground).toHaveBeenCalledOnce()
    // Critical: refund must be called when enqueue fails after freeze.
    expect(billingMock.refundForPlayground).toHaveBeenCalledOnce()
    const refundCall = billingMock.refundForPlayground.mock.calls[0]?.[0] as
      | { freezeId: string; reason: string }
      | undefined
    expect(refundCall?.freezeId).toBe('freeze-xyz')
    expect(refundCall?.reason).toContain('enqueue_failed')
  })

  it('quotedCost=0 (mode=OFF or no pricing) → no freeze, no row freezeId, enqueue still runs', async () => {
    billingMock.quotePlaygroundCost.mockResolvedValueOnce({ quotedCost: 0, pricingVersion: '2026-02-19' })

    const { POST } = await loadRoute()
    const req = buildMockRequest({ path: '/api/playground/run', method: 'POST', body: postBody() })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    // freeze NOT called when quotedCost is 0.
    expect(billingMock.freezeForPlayground).not.toHaveBeenCalled()
    // costEstimate written as null (since quotedCost was 0).
    const createArgs = prismaMock.playgroundRun.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(createArgs.data.costEstimate).toBeNull()
    // Enqueue still runs (free model is still a valid submit).
    expect(enqueueMock.enqueuePlaygroundImageJob).toHaveBeenCalledOnce()
    // No refund.
    expect(billingMock.refundForPlayground).not.toHaveBeenCalled()
  })

  it('video outputType → freeze with durationSec + resolution → video enqueue', async () => {
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
    const quoteCall = billingMock.quotePlaygroundCost.mock.calls[0]?.[0] as
      | { outputType: string; durationSec: number; resolution: string }
      | undefined
    expect(quoteCall?.outputType).toBe('video')
    expect(quoteCall?.durationSec).toBe(8)
    expect(quoteCall?.resolution).toBe('1080p')
    expect(enqueueMock.enqueuePlaygroundVideoJob).toHaveBeenCalledOnce()
    expect(enqueueMock.enqueuePlaygroundImageJob).not.toHaveBeenCalled()
  })
})
