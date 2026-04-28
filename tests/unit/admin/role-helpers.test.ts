/**
 * Unit tests for the role-aware auth helpers added in K1.
 *
 * The full requireRoleAuth path goes through getServerSession (next-auth)
 * + prisma + the next.js cookie/header machinery, which is expensive to
 * stand up. We mock those dependencies and assert the small set of
 * behaviors the multi-user system depends on:
 *   - admin always passes
 *   - non-admin without an allow-list match is forbidden
 *   - inactive accounts are forbidden regardless of role
 *   - missing / unauthenticated session yields unauthorized
 *   - legacy role 'user' is normalized to 'member'
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sessionMock = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

const retryMock = vi.hoisted(() => ({
  withPrismaRetry: vi.fn((fn: () => unknown) => Promise.resolve(fn())),
}))

vi.mock('next-auth/next', () => ({
  getServerSession: () => sessionMock.getAuthSession(),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: retryMock.withPrismaRetry,
}))

vi.mock('@/lib/config-service', () => ({
  extractModelKey: (v: unknown) => v,
}))

vi.mock('@/lib/errors/codes', () => ({
  getErrorSpec: (code: string) => {
    const map: Record<string, number> = {
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      INVALID_PARAMS: 400,
      INTERNAL_ERROR: 500,
    }
    return { httpStatus: map[code] ?? 500, defaultMessage: code }
  },
}))

vi.mock('@/lib/logging/context', () => ({
  getLogContext: () => ({ requestId: undefined }),
  setLogContext: vi.fn(),
}))

import { requireRoleAuth, requireEditorAuth } from '@/lib/api-auth'

// In the vitest node env, NextResponse.json(…) yields a plain Response with
// the expected status. We only need the status numbers — a structural check.
function isResponseLike(value: unknown): value is { status: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'number'
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

function setSession(user: { id?: string } | null) {
  sessionMock.getAuthSession.mockResolvedValueOnce(user ? { user } : null)
}

function setUserRow(row: { role: string | null; isActive?: boolean } | null) {
  prismaMock.user.findUnique.mockResolvedValueOnce(row)
}

function isUnauthorized(value: unknown): boolean {
  return isResponseLike(value) && value.status === 401
}
function isForbidden(value: unknown): boolean {
  return isResponseLike(value) && value.status === 403
}

describe('requireRoleAuth', () => {
  it('returns NextResponse 401 when no session', async () => {
    setSession(null)
    const result = await requireRoleAuth(['editor'])
    expect(isUnauthorized(result)).toBe(true)
  })

  it('returns NextResponse 401 when session has no user id', async () => {
    setSession({})
    const result = await requireRoleAuth(['editor'])
    expect(isUnauthorized(result)).toBe(true)
  })

  it('returns NextResponse 401 when user row is missing', async () => {
    setSession({ id: 'u1' })
    setUserRow(null)
    const result = await requireRoleAuth(['editor'])
    expect(isUnauthorized(result)).toBe(true)
  })

  it('returns NextResponse 403 when user is disabled, even for admin', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: 'admin', isActive: false })
    const result = await requireRoleAuth(['admin'])
    expect(isForbidden(result)).toBe(true)
  })

  it('admin passes any allow-list', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: 'admin', isActive: true })
    const result = await requireRoleAuth(['member'])
    expect(isResponseLike(result)).toBe(false)
    if (!isResponseLike(result)) {
      const ok = result as { role: string; session: { user: { id: string } } }
      expect(ok.role).toBe('admin')
      expect(ok.session.user.id).toBe('u1')
    }
  })

  it('editor passes when editor is in allow list', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: 'editor', isActive: true })
    const result = await requireRoleAuth(['editor'])
    expect(isResponseLike(result)).toBe(false)
    if (!isResponseLike(result)) {
      expect((result as { role: string }).role).toBe('editor')
    }
  })

  it('member is forbidden from an editor-only allow list', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: 'member', isActive: true })
    const result = await requireRoleAuth(['editor'])
    expect(isForbidden(result)).toBe(true)
  })

  it('legacy role "user" is normalized to member', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: 'user', isActive: true })
    const result = await requireRoleAuth(['member'])
    expect(isResponseLike(result)).toBe(false)
    if (!isResponseLike(result)) {
      expect((result as { role: string }).role).toBe('member')
    }
  })

  it('legacy role "user" is forbidden from editor-only list', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: 'user', isActive: true })
    const result = await requireRoleAuth(['editor'])
    expect(isForbidden(result)).toBe(true)
  })

  it('null role normalizes to member', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: null, isActive: true })
    const result = await requireRoleAuth(['member'])
    expect(isResponseLike(result)).toBe(false)
    if (!isResponseLike(result)) {
      expect((result as { role: string }).role).toBe('member')
    }
  })
})

describe('requireEditorAuth', () => {
  it('passes for editor', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: 'editor', isActive: true })
    const result = await requireEditorAuth()
    expect(isResponseLike(result)).toBe(false)
  })

  it('passes for admin (admin override)', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: 'admin', isActive: true })
    const result = await requireEditorAuth()
    expect(isResponseLike(result)).toBe(false)
  })

  it('forbids member', async () => {
    setSession({ id: 'u1' })
    setUserRow({ role: 'member', isActive: true })
    const result = await requireEditorAuth()
    expect(isForbidden(result)).toBe(true)
  })
})
