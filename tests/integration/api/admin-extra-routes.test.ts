/**
 * Admin endpoints regression — covers the 5 endpoints added in aa48169
 * + the augmented /api/admin/users response in 6ca1bc5.
 *
 * Strategy: mock prisma + auth helpers, run the route handlers, assert
 * response shape and that critical aggregations / validations fire.
 * Uses the same test harness as multi-user-isolation.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '@prisma/client/runtime/library'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockRole,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  userBalance: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  balanceFreeze: {
    create: vi.fn(),
  },
  mediaObject: {
    groupBy: vi.fn(),
  },
  graphRun: {
    findMany: vi.fn(),
  },
  project: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn(prismaMock as unknown)
  }),
}))

// Mock BullMQ queues so /queue-stats can run without redis
const queueMock = vi.hoisted(() => {
  const mk = (name: string) => ({
    name,
    getWaitingCount: vi.fn(async () => 0),
    getActiveCount: vi.fn(async () => 0),
    getCompletedCount: vi.fn(async () => 0),
    getFailedCount: vi.fn(async () => 0),
    getDelayedCount: vi.fn(async () => 0),
    isPaused: vi.fn(async () => false),
  })
  return {
    imageQueue: mk('image'),
    videoQueue: mk('video'),
    voiceQueue: mk('voice'),
    textQueue: mk('text'),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/queues', () => queueMock)

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('admin-user')
  mockRole('admin')
  // Restore the $transaction helper after clearAllMocks
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock as unknown),
  )
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('Admin extra endpoints', () => {
  it('GET /api/admin/users includes balance + storage per user', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: 'u1', name: 'alice', email: 'a@x.com', displayName: null, role: 'admin', isActive: true, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'u2', name: 'bob', email: 'b@x.com', displayName: null, role: 'editor', isActive: true, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() },
    ])
    prismaMock.userBalance.findMany.mockResolvedValueOnce([
      { userId: 'u1', balance: new Decimal('100.5'), frozenAmount: new Decimal('0'), totalSpent: new Decimal('0') },
    ])
    prismaMock.mediaObject.groupBy.mockResolvedValueOnce([
      { uploadedByUserId: 'u1', _sum: { sizeBytes: BigInt(1024) }, _count: { id: 3 } },
      { uploadedByUserId: null, _sum: { sizeBytes: BigInt(99) }, _count: { id: 1 } },
    ])

    const { GET } = await import('@/app/api/admin/users/route')
    const res = await callRoute(GET as never, {
      path: '/api/admin/users',
      method: 'GET',
      context: undefined as never,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { users: Array<{ id: string; balance: { balance: string } | null; storage: { bytes: string; objectCount: number } }> }
    expect(body.users).toHaveLength(2)
    const alice = body.users.find((u) => u.id === 'u1')
    const bob = body.users.find((u) => u.id === 'u2')
    expect(alice?.balance?.balance).toBe('100.5')
    expect(alice?.storage.bytes).toBe('1024')
    expect(alice?.storage.objectCount).toBe(3)
    // u2 has no balance row, no storage rows — defaults
    expect(bob?.balance).toBeNull()
    expect(bob?.storage.bytes).toBe('0')
    // The null-uploadedByUserId row must not bucket against any user
    expect(alice?.storage.objectCount).not.toBe(4)
  })

  it('POST /balance/credit refuses delta that drives balance below zero', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', name: 'alice' })
    prismaMock.userBalance.upsert.mockResolvedValueOnce({
      userId: 'u1',
      balance: new Decimal('10'),
      frozenAmount: new Decimal('0'),
      totalSpent: new Decimal('0'),
    })

    const { POST } = await import('@/app/api/admin/users/[id]/balance/credit/route')
    const res = await callRoute(POST as never, {
      path: '/api/admin/users/u1/balance/credit',
      method: 'POST',
      body: { delta: -50, note: 'oops' },
      context: { params: Promise.resolve({ id: 'u1' }) } as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.userBalance.update).not.toHaveBeenCalled()
    expect(prismaMock.balanceFreeze.create).not.toHaveBeenCalled()
  })

  it('POST /balance/credit caps |delta| <= 1,000,000', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', name: 'alice' })

    const { POST } = await import('@/app/api/admin/users/[id]/balance/credit/route')
    const res = await callRoute(POST as never, {
      path: '/api/admin/users/u1/balance/credit',
      method: 'POST',
      body: { delta: 9_999_999 },
      context: { params: Promise.resolve({ id: 'u1' }) } as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.userBalance.upsert).not.toHaveBeenCalled()
  })

  it('POST /balance/credit happy path persists + audit row', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', name: 'alice' })
    prismaMock.userBalance.upsert.mockResolvedValueOnce({
      userId: 'u1',
      balance: new Decimal('10'),
      frozenAmount: new Decimal('0'),
      totalSpent: new Decimal('0'),
    })
    prismaMock.userBalance.update.mockResolvedValueOnce({
      userId: 'u1',
      balance: new Decimal('60'),
      frozenAmount: new Decimal('0'),
      totalSpent: new Decimal('0'),
    })
    prismaMock.balanceFreeze.create.mockResolvedValueOnce({ id: 'freeze-1' })

    const { POST } = await import('@/app/api/admin/users/[id]/balance/credit/route')
    const res = await callRoute(POST as never, {
      path: '/api/admin/users/u1/balance/credit',
      method: 'POST',
      body: { delta: 50, note: 'demo top-up' },
      context: { params: Promise.resolve({ id: 'u1' }) } as never,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { delta: number; balance: { balance: string } }
    expect(body.delta).toBe(50)
    expect(body.balance.balance).toBe('60')
    expect(prismaMock.userBalance.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.balanceFreeze.create).toHaveBeenCalledTimes(1)
    const freezeCall = prismaMock.balanceFreeze.create.mock.calls[0][0] as { data: { status: string; metadata: string } }
    expect(freezeCall.data.status).toBe('admin-credit')
    expect(freezeCall.data.metadata).toContain('demo top-up')
  })

  it('GET /api/admin/runs defaults to status=failed', async () => {
    prismaMock.graphRun.findMany.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/admin/runs/route')
    await callRoute(GET as never, {
      path: '/api/admin/runs',
      method: 'GET',
      context: undefined as never,
    })

    const call = prismaMock.graphRun.findMany.mock.calls[0][0] as { where: { status?: string } }
    expect(call.where.status).toBe('failed')
  })

  it('GET /api/admin/runs status=all drops the filter', async () => {
    prismaMock.graphRun.findMany.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/admin/runs/route')
    await callRoute(GET as never, {
      path: '/api/admin/runs?status=all',
      method: 'GET',
      query: { status: 'all' },
      context: undefined as never,
    })

    const call = prismaMock.graphRun.findMany.mock.calls[0][0] as { where: { status?: string } }
    expect(call.where.status).toBeUndefined()
  })

  it('GET /api/admin/queue-stats returns a snapshot for all 4 queues', async () => {
    queueMock.imageQueue.getActiveCount.mockResolvedValueOnce(3)
    queueMock.videoQueue.getFailedCount.mockResolvedValueOnce(2)

    const { GET } = await import('@/app/api/admin/queue-stats/route')
    const res = await callRoute(GET as never, {
      path: '/api/admin/queue-stats',
      method: 'GET',
      context: undefined as never,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { queues: Array<{ name: string; active: number; failed: number }> }
    expect(body.queues).toHaveLength(4)
    const image = body.queues.find((q) => q.name === 'image')
    const video = body.queues.find((q) => q.name === 'video')
    expect(image?.active).toBe(3)
    expect(video?.failed).toBe(2)
  })
})
