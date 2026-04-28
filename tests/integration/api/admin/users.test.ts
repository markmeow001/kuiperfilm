/**
 * Integration tests for /api/admin/users — list + change role + set active.
 *
 * Uses the same pattern as other tests in this directory:
 * - prisma fully mocked
 * - @/lib/api-auth mocked via the installAuthMocks helper (extended in
 *   K5/C to support admin/editor role gating)
 * - The real route handler + admin-service + apiHandler error mapping
 *   run, so ApiError → NextResponse status conversion is exercised
 *   end-to-end.
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
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  inviteCode: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
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

describe('GET /api/admin/users', () => {
  it('returns the user list when caller is admin', async () => {
    const sample = [
      { id: 'u1', name: 'alice', role: 'editor', isActive: true },
      { id: 'u2', name: 'bob', role: 'member', isActive: true },
    ]
    prismaMock.user.findMany.mockResolvedValueOnce(sample)

    const route = await import('@/app/api/admin/users/route')
    const res = await callRoute(route.GET as any, {
      path: '/api/admin/users',
      method: 'GET',
      context: undefined,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users).toEqual(sample)
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-admin caller with 403', async () => {
    mockRole('editor')
    const route = await import('@/app/api/admin/users/route')
    const res = await callRoute(route.GET as any, {
      path: '/api/admin/users',
      method: 'GET',
      context: undefined,
    })
    expect(res.status).toBe(403)
    expect(prismaMock.user.findMany).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/admin/users/:id/role', () => {
  it('changes role for another user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u2',
      role: 'member',
    })
    prismaMock.user.update.mockResolvedValueOnce({
      id: 'u2',
      name: 'bob',
      role: 'editor',
      isActive: true,
    })

    const route = await import('@/app/api/admin/users/[id]/role/route')
    const req = buildMockRequest({
      path: '/api/admin/users/u2/role',
      method: 'PATCH',
      body: { role: 'editor' },
    })
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.role).toBe('editor')
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u2' },
        data: { role: 'editor' },
      }),
    )
  })

  it('forbids changing your own role', async () => {
    const route = await import('@/app/api/admin/users/[id]/role/route')
    const req = buildMockRequest({
      path: '/api/admin/users/admin-1/role',
      method: 'PATCH',
      body: { role: 'member' },
    })
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'admin-1' }) })
    expect(res.status).toBe(403)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid role', async () => {
    const route = await import('@/app/api/admin/users/[id]/role/route')
    const req = buildMockRequest({
      path: '/api/admin/users/u2/role',
      method: 'PATCH',
      body: { role: 'overlord' },
    })
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(400)
  })

  it('returns 404 when target user is missing', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    const route = await import('@/app/api/admin/users/[id]/role/route')
    const req = buildMockRequest({
      path: '/api/admin/users/missing/role',
      method: 'PATCH',
      body: { role: 'editor' },
    })
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('blocks demoting the last active admin', async () => {
    prismaMock.user.findUnique
      // first lookup: target user (admin)
      .mockResolvedValueOnce({ id: 'u9', role: 'admin' })
      // second lookup inside assertNotLastActiveAdmin
      .mockResolvedValueOnce({ role: 'admin', isActive: true })
    prismaMock.user.count.mockResolvedValueOnce(0)

    const route = await import('@/app/api/admin/users/[id]/role/route')
    const req = buildMockRequest({
      path: '/api/admin/users/u9/role',
      method: 'PATCH',
      body: { role: 'member' },
    })
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'u9' }) })
    expect(res.status).toBe(409) // CONFLICT
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/admin/users/:id/active', () => {
  it('disables a user', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: 'u2' }) // exists check
      .mockResolvedValueOnce({ role: 'member', isActive: true }) // assertNotLastActiveAdmin self-lookup (won't trip last-admin)
    prismaMock.user.update.mockResolvedValueOnce({
      id: 'u2',
      role: 'member',
      isActive: false,
    })

    const route = await import('@/app/api/admin/users/[id]/active/route')
    const req = buildMockRequest({
      path: '/api/admin/users/u2/active',
      method: 'PATCH',
      body: { isActive: false },
    })
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.isActive).toBe(false)
  })

  it('forbids disabling self', async () => {
    const route = await import('@/app/api/admin/users/[id]/active/route')
    const req = buildMockRequest({
      path: '/api/admin/users/admin-1/active',
      method: 'PATCH',
      body: { isActive: false },
    })
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'admin-1' }) })
    expect(res.status).toBe(403)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('rejects non-boolean isActive', async () => {
    const route = await import('@/app/api/admin/users/[id]/active/route')
    const req = buildMockRequest({
      path: '/api/admin/users/u2/active',
      method: 'PATCH',
      body: { isActive: 'yes' },
    })
    const res = await route.PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(400)
  })
})
