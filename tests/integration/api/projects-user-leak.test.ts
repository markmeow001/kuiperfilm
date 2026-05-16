/**
 * Regression: /api/projects/[id] and /api/projects/[id]/data must not
 * leak the full User row to the client.
 *
 * 2026-05-15 audit found that both GET handlers used
 *   prisma.project.findUnique({ include: { user: true } })
 * which dumped password (bcrypt), email, emailVerified, lastLoginAt and
 * timestamps to whoever called the API. bcrypt is one-way but exposing
 * hashes still gives offline attackers a target, and email leakage
 * breaks the "internal team can't see each other's email" expectation
 * established when memory `project_kuiperfilm_security_posture.md` was
 * written.
 *
 * Fix: both routes now use `include: { user: { select: PUBLIC_USER_SELECT } }`
 * where PUBLIC_USER_SELECT exposes only id/name/displayName/role.
 *
 * This test pins the projection so a future include: { user: true }
 * regression fails CI loudly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const BCRYPT_HASH = '$2b$12$E.gv1ng/xF6h3iPLAPiB.eTmD.SdKyF8eKBzItPrhDpZbqo/tO9zK'
const EMAIL = 'admin-leak-test@example.com'

const projectRow = {
  id: 'proj-1',
  name: 'p',
  description: null,
  mode: 'novel-promotion',
  userId: 'user-A',
  createdAt: new Date('2026-05-01T00:00:00Z'),
  updatedAt: new Date('2026-05-01T00:00:00Z'),
  lastAccessedAt: new Date('2026-05-01T00:00:00Z'),
  user: {
    id: 'user-A',
    name: 'admin',
    displayName: null,
    role: 'admin',
  },
}

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionProject: {
    // Return a minimal record so /data route reaches its final response
    // (otherwise it 404s before the body-leak assertion has a chance).
    findUnique: vi.fn(async () => ({
      id: 'np-1',
      projectId: 'proj-1',
      videoModel: null,
      videoRatio: null,
      episodes: [],
      characters: [],
      locations: [],
    })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({
  addSignedUrlsToProject: (p: unknown) => p,
  deleteCOSObjects: vi.fn(async () => undefined),
}))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: (p: unknown) => p,
}))
vi.mock('@/lib/multi-user/preference-inheritance', () => ({
  applyAdminFallbackToNovelPromotionProject: vi.fn(async () => undefined),
}))
vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: vi.fn(() => null),
}))
vi.mock('@/lib/logging/semantic', () => ({
  logProjectAction: vi.fn(),
}))

// Mock Prisma the way the real client behaves: when called with
// `include: { user: { select: {...} } }`, only the selected keys come back.
// Without this, the mock returns whatever we put in and the response-body
// leak assertions can't tell whether the handler's projection actually
// worked vs. the mock just happened to be clean.
function applyUserSelect(
  row: typeof projectRow & { user: Record<string, unknown> },
  args: { include?: { user?: boolean | { select?: Record<string, boolean> } } } | undefined,
) {
  const userInclude = args?.include?.user
  if (userInclude === true || userInclude === undefined) {
    return row
  }
  if (userInclude && typeof userInclude === 'object' && userInclude.select) {
    const projected: Record<string, unknown> = {}
    for (const key of Object.keys(userInclude.select)) {
      if (userInclude.select[key]) projected[key] = row.user[key]
    }
    return { ...row, user: projected }
  }
  return row
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
  prismaMock.project.findUnique.mockImplementation(async (args: unknown) =>
    applyUserSelect(projectRow, args as Parameters<typeof applyUserSelect>[1]),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/projects/[projectId] — user projection', () => {
  it('does not leak password/email even if Prisma row carries them', async () => {
    // Simulate a DB row carrying sensitive fields the handler shouldn't
    // expose. The mock honors the handler's `select` projection (see
    // applyUserSelect above), so leaks only happen if the handler asks for
    // password/email by name.
    const dbRow = {
      ...projectRow,
      user: {
        ...projectRow.user,
        password: BCRYPT_HASH,
        email: EMAIL,
        lastLoginAt: new Date('2026-05-01T00:00:00Z'),
      },
    }
    prismaMock.project.findUnique.mockImplementation(async (args: unknown) =>
      applyUserSelect(dbRow, args as Parameters<typeof applyUserSelect>[1]),
    )

    const { GET } = await import('@/app/api/projects/[projectId]/route')
    const res = await callRoute(GET, {
      path: '/api/projects/proj-1',
      method: 'GET',
      context: { params: Promise.resolve({ projectId: 'proj-1' }) },
    })

    // Production fix uses Prisma `select` so password/email never reach
    // the handler — but we also assert response body doesn't echo them
    // in case a future PR regresses to `include: { user: true }`.
    const body = await res.json()
    const raw = JSON.stringify(body)
    expect(raw).not.toContain(BCRYPT_HASH)
    expect(raw).not.toContain(EMAIL)
    expect(raw).not.toContain('lastLoginAt')

    // Public fields still present.
    expect(body.project.user.id).toBe('user-A')
    expect(body.project.user.name).toBe('admin')
    expect(body.project.user.role).toBe('admin')
  })

  it('asserts Prisma is called with select, not bare include true', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/route')
    await callRoute(GET, {
      path: '/api/projects/proj-1',
      method: 'GET',
      context: { params: Promise.resolve({ projectId: 'proj-1' }) },
    })

    expect(prismaMock.project.findUnique).toHaveBeenCalled()
    const call = prismaMock.project.findUnique.mock.calls[0][0]
    // user must be a nested select projection, not `true`
    expect(call.include?.user).not.toBe(true)
    expect(call.include?.user?.select).toMatchObject({
      id: true,
      name: true,
      role: true,
    })
    // Must NOT include sensitive fields
    expect(call.include?.user?.select?.password).toBeUndefined()
    expect(call.include?.user?.select?.email).toBeUndefined()
  })
})

describe('GET /api/projects/[projectId]/data — user projection', () => {
  it('does not leak password/email', async () => {
    const dbRow = {
      ...projectRow,
      user: {
        ...projectRow.user,
        password: BCRYPT_HASH,
        email: EMAIL,
        lastLoginAt: new Date('2026-05-01T00:00:00Z'),
      },
    }
    prismaMock.project.findUnique.mockImplementation(async (args: unknown) =>
      applyUserSelect(dbRow, args as Parameters<typeof applyUserSelect>[1]),
    )

    const { GET } = await import('@/app/api/projects/[projectId]/data/route')
    const res = await callRoute(GET, {
      path: '/api/projects/proj-1/data',
      method: 'GET',
      context: { params: Promise.resolve({ projectId: 'proj-1' }) },
    })

    const body = await res.json()
    const raw = JSON.stringify(body)
    expect(raw).not.toContain(BCRYPT_HASH)
    expect(raw).not.toContain(EMAIL)
    expect(raw).not.toContain('lastLoginAt')
  })

  it('asserts Prisma uses select for nested user', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/data/route')
    await callRoute(GET, {
      path: '/api/projects/proj-1/data',
      method: 'GET',
      context: { params: Promise.resolve({ projectId: 'proj-1' }) },
    })

    const call = prismaMock.project.findUnique.mock.calls[0][0]
    expect(call.include?.user).not.toBe(true)
    expect(call.include?.user?.select?.password).toBeUndefined()
    expect(call.include?.user?.select?.email).toBeUndefined()
  })
})
