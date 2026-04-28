/**
 * Integration test for the K2 invite-only registration flow.
 *
 * Mocks prisma + bcrypt; runs the real /api/auth/register route handler
 * end-to-end through apiHandler so ApiError → 4xx mapping is covered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const prismaMock = vi.hoisted(() => {
  const tx = {
    inviteCode: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    userBalance: {
      create: vi.fn(),
    },
  }
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock.prisma }))

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (pw: string) => `hashed:${pw}`),
    compare: vi.fn(),
  },
  hash: vi.fn(async (pw: string) => `hashed:${pw}`),
  compare: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  prismaMock.prisma.$transaction.mockImplementation(
    async (fn: (t: typeof prismaMock.tx) => Promise<unknown>) => fn(prismaMock.tx),
  )
})

afterEach(() => {
  vi.resetAllMocks()
})

function mountUsableInvite(role = 'member') {
  prismaMock.tx.inviteCode.findUnique.mockResolvedValueOnce({
    id: 'inv-1',
    code: 'GOOD',
    role,
    usedBy: null,
    revokedAt: null,
    expiresAt: null,
  })
  prismaMock.tx.user.findUnique.mockResolvedValueOnce(null) // username free
}

describe('POST /api/auth/register (invite-only flow)', () => {
  it('creates user + balance + consumes invite when all inputs are valid', async () => {
    mountUsableInvite('editor')
    prismaMock.tx.user.create.mockResolvedValueOnce({
      id: 'new-1',
      name: 'alice',
      role: 'editor',
    })
    prismaMock.tx.userBalance.create.mockResolvedValueOnce({})
    prismaMock.tx.inviteCode.update.mockResolvedValueOnce({})

    const route = await import('@/app/api/auth/register/route')
    const req = buildMockRequest({
      path: '/api/auth/register',
      method: 'POST',
      body: {
        name: 'alice',
        password: 'pass1234',
        invite_code: 'GOOD',
        email: 'alice@example.com',
        displayName: 'Alice',
      },
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user).toMatchObject({
      id: 'new-1',
      name: 'alice',
      role: 'editor',
    })

    // user.create receives the invite-derived role + email + displayName.
    const createCall = prismaMock.tx.user.create.mock.calls[0][0]
    expect(createCall.data).toMatchObject({
      name: 'alice',
      role: 'editor',
      email: 'alice@example.com',
      displayName: 'Alice',
    })
    expect(createCall.data.password).toBe('hashed:pass1234')

    // Invite is marked used, with usedBy + usedAt.
    const updateCall = prismaMock.tx.inviteCode.update.mock.calls[0][0]
    expect(updateCall.data.usedBy).toBe('new-1')
    expect(updateCall.data.usedAt).toBeInstanceOf(Date)

    // Balance row created for the new user.
    expect(prismaMock.tx.userBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'new-1' }),
      }),
    )
  })

  it.each<[Record<string, unknown>, string]>([
    [{ password: 'pass1234', invite_code: 'X' }, 'name'],
    [{ name: 'a', invite_code: 'X' }, 'password'],
    [{ name: 'a', password: 'pass1234' }, 'invite_code'],
    [{ name: 'a', password: 'pass1234', invite_code: '   ' }, 'whitespace invite'],
    [{ name: 'a', password: 'short', invite_code: 'X' }, 'short password'],
  ])('rejects request missing %s with 400', async (body, _label) => {
    const route = await import('@/app/api/auth/register/route')
    const req = buildMockRequest({
      path: '/api/auth/register',
      method: 'POST',
      body,
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
    expect(prismaMock.tx.user.create).not.toHaveBeenCalled()
  })

  it('rejects unknown invite code', async () => {
    prismaMock.tx.inviteCode.findUnique.mockResolvedValueOnce(null)
    const route = await import('@/app/api/auth/register/route')
    const req = buildMockRequest({
      path: '/api/auth/register',
      method: 'POST',
      body: { name: 'a', password: 'pass1234', invite_code: 'NOPE' },
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
    expect(prismaMock.tx.user.create).not.toHaveBeenCalled()
  })

  it('rejects already-used invite', async () => {
    prismaMock.tx.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i',
      role: 'member',
      usedBy: 'someone',
      revokedAt: null,
      expiresAt: null,
    })
    const route = await import('@/app/api/auth/register/route')
    const req = buildMockRequest({
      path: '/api/auth/register',
      method: 'POST',
      body: { name: 'a', password: 'pass1234', invite_code: 'USED' },
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
  })

  it('rejects revoked invite', async () => {
    prismaMock.tx.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i',
      role: 'member',
      usedBy: null,
      revokedAt: new Date(),
      expiresAt: null,
    })
    const route = await import('@/app/api/auth/register/route')
    const req = buildMockRequest({
      path: '/api/auth/register',
      method: 'POST',
      body: { name: 'a', password: 'pass1234', invite_code: 'REVOKED' },
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
  })

  it('rejects expired invite', async () => {
    prismaMock.tx.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i',
      role: 'member',
      usedBy: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    })
    const route = await import('@/app/api/auth/register/route')
    const req = buildMockRequest({
      path: '/api/auth/register',
      method: 'POST',
      body: { name: 'a', password: 'pass1234', invite_code: 'EXPIRED' },
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
  })

  it('rejects duplicate username', async () => {
    prismaMock.tx.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i',
      role: 'member',
      usedBy: null,
      revokedAt: null,
      expiresAt: null,
    })
    prismaMock.tx.user.findUnique.mockResolvedValueOnce({ id: 'existing', name: 'taken' })
    const route = await import('@/app/api/auth/register/route')
    const req = buildMockRequest({
      path: '/api/auth/register',
      method: 'POST',
      body: { name: 'taken', password: 'pass1234', invite_code: 'GOOD' },
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
    expect(prismaMock.tx.user.create).not.toHaveBeenCalled()
  })

  it('omits email + displayName when caller does not supply them', async () => {
    mountUsableInvite('member')
    prismaMock.tx.user.create.mockResolvedValueOnce({
      id: 'new-2',
      name: 'bob',
      role: 'member',
    })

    const route = await import('@/app/api/auth/register/route')
    const req = buildMockRequest({
      path: '/api/auth/register',
      method: 'POST',
      body: { name: 'bob', password: 'pass1234', invite_code: 'GOOD' },
    })
    await route.POST(req, { params: Promise.resolve({}) } as any)

    const createCall = prismaMock.tx.user.create.mock.calls[0][0]
    expect(createCall.data.email).toBeUndefined()
    expect(createCall.data.displayName).toBeUndefined()
  })
})
