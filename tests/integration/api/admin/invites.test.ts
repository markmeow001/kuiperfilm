/**
 * Integration tests for /api/admin/invites — list / create / revoke.
 *
 * Same harness as users.test.ts. The route handlers run real, prisma is
 * mocked, and admin-service.createInvite/revokeInvite are exercised as
 * the production code path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest, callRoute } from '../../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockRole,
  resetAuthMockState,
} from '../../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  inviteCode: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    count: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('admin-1')
  mockRole('admin')
})

afterEach(() => {
  resetAuthMockState()
})

describe('GET /api/admin/invites', () => {
  it('returns invites with creator + user includes', async () => {
    const sample = [
      {
        id: 'inv1',
        code: 'ABCDEF1234',
        role: 'editor',
        createdBy: 'admin-1',
        usedBy: null,
        creator: { id: 'admin-1', name: 'admin', displayName: null },
        user: null,
      },
    ]
    prismaMock.inviteCode.findMany.mockResolvedValueOnce(sample)

    const route = await import('@/app/api/admin/invites/route')
    const res = await callRoute(route.GET as any, {
      path: '/api/admin/invites',
      method: 'GET',
      context: undefined,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invites).toEqual(sample)
    // Verify the route asks for the relations it advertises.
    const findManyArgs = prismaMock.inviteCode.findMany.mock.calls[0][0]
    expect(findManyArgs.include).toMatchObject({
      creator: expect.any(Object),
      user: expect.any(Object),
    })
  })

  it('rejects non-admin caller with 403', async () => {
    mockRole('editor')
    const route = await import('@/app/api/admin/invites/route')
    const res = await callRoute(route.GET as any, {
      path: '/api/admin/invites',
      method: 'GET',
      context: undefined,
    })
    expect(res.status).toBe(403)
    expect(prismaMock.inviteCode.findMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/invites', () => {
  it('creates an invite with default role + no expiry', async () => {
    prismaMock.inviteCode.create.mockImplementation(({ data }: any) => ({
      id: 'i-new',
      ...data,
    }))

    const route = await import('@/app/api/admin/invites/route')
    const req = buildMockRequest({
      path: '/api/admin/invites',
      method: 'POST',
      body: {},
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.invite.role).toBe('member')
    expect(body.invite.expiresAt).toBeNull()
    expect(body.invite.createdBy).toBe('admin-1')
    expect(body.invite.code).toMatch(/^[0-9A-F]{24}$/)
  })

  it('honors valid role + expires_hours + note', async () => {
    prismaMock.inviteCode.create.mockImplementation(({ data }: any) => ({
      id: 'i-2',
      ...data,
    }))

    const route = await import('@/app/api/admin/invites/route')
    const req = buildMockRequest({
      path: '/api/admin/invites',
      method: 'POST',
      body: { role: 'editor', expires_hours: 24, note: '  trial  ' },
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.invite.role).toBe('editor')
    expect(body.invite.note).toBe('trial')
    expect(new Date(body.invite.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('rejects invalid role', async () => {
    const route = await import('@/app/api/admin/invites/route')
    const req = buildMockRequest({
      path: '/api/admin/invites',
      method: 'POST',
      body: { role: 'overlord' },
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
  })

  it.each([
    [-1, 'negative'],
    [0, 'zero'],
    [9000, 'over a year'],
    ['168', 'string instead of number'],
  ])('rejects expires_hours = %p (%s)', async (hours, _label) => {
    const route = await import('@/app/api/admin/invites/route')
    const req = buildMockRequest({
      path: '/api/admin/invites',
      method: 'POST',
      body: { expires_hours: hours },
    })
    const res = await route.POST(req, { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/admin/invites/:id', () => {
  it('revokes a usable invite', async () => {
    prismaMock.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i1',
      usedBy: null,
      revokedAt: null,
    })
    prismaMock.inviteCode.update.mockResolvedValueOnce({})

    const route = await import('@/app/api/admin/invites/[id]/route')
    const req = buildMockRequest({
      path: '/api/admin/invites/i1',
      method: 'DELETE',
    })
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'i1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.revoked).toBe(true)
    expect(prismaMock.inviteCode.update).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when invite is missing', async () => {
    prismaMock.inviteCode.findUnique.mockResolvedValueOnce(null)
    const route = await import('@/app/api/admin/invites/[id]/route')
    const req = buildMockRequest({
      path: '/api/admin/invites/missing',
      method: 'DELETE',
    })
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
    expect(prismaMock.inviteCode.update).not.toHaveBeenCalled()
  })

  it('returns 409 when invite already used', async () => {
    prismaMock.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i2',
      usedBy: 'u9',
      revokedAt: null,
    })
    const route = await import('@/app/api/admin/invites/[id]/route')
    const req = buildMockRequest({
      path: '/api/admin/invites/i2',
      method: 'DELETE',
    })
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'i2' }) })
    expect(res.status).toBe(409)
  })

  it('returns 409 when invite already revoked', async () => {
    prismaMock.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i3',
      usedBy: null,
      revokedAt: new Date(),
    })
    const route = await import('@/app/api/admin/invites/[id]/route')
    const req = buildMockRequest({
      path: '/api/admin/invites/i3',
      method: 'DELETE',
    })
    const res = await route.DELETE(req, { params: Promise.resolve({ id: 'i3' }) })
    expect(res.status).toBe(409)
  })
})
