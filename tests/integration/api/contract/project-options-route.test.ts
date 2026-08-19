import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({ authenticated: true }))
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  project: { findMany: vi.fn() },
}))

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireUserAuth: async () => {
    if (!authState.authenticated) {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    return { session: { user: { id: 'user-1' } } }
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-owned',
    name: 'Owned project',
    userId: 'user-1',
    workspaceId: null,
    collaborators: [],
    workspace: null,
    user: { workspaceMemberships: [] },
    ...overrides,
  }
}

describe('GET /api/projects/options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    prismaMock.user.findUnique.mockResolvedValue({ role: 'member' })
    prismaMock.project.findMany.mockResolvedValue([])
  })

  it('未登入 -> 401', async () => {
    authState.authenticated = false
    const { GET } = await import('@/app/api/projects/options/route')
    const request = buildMockRequest({ path: '/api/projects/options', method: 'GET' })

    const response = await GET(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
    expect(prismaMock.project.findMany).not.toHaveBeenCalled()
  })

  it('一般使用者 -> 輕量列出 own、workspace viewer 與 explicit editor 權限', async () => {
    prismaMock.project.findMany.mockResolvedValue([
      projectRow(),
      projectRow({
        id: 'project-viewer',
        name: 'Workspace viewer project',
        userId: 'user-2',
        workspaceId: 'workspace-1',
        workspace: {
          ownerEditorId: 'user-2',
          members: [{ role: 'viewer' }],
        },
      }),
      projectRow({
        id: 'project-editor',
        name: 'Explicit editor project',
        userId: 'user-3',
        collaborators: [{ role: 'editor' }],
      }),
    ])
    const { GET } = await import('@/app/api/projects/options/route')
    const request = buildMockRequest({
      path: '/api/projects/options',
      method: 'GET',
      query: { limit: 2 },
    })

    const response = await GET(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      projects: Array<Record<string, unknown>>
      nextCursor: string | null
    }
    expect(payload.projects).toEqual([
      expect.objectContaining({
        id: 'project-owned',
        effectiveRole: 'owner',
        canEdit: true,
      }),
      expect.objectContaining({
        id: 'project-viewer',
        effectiveRole: 'viewer',
        canEdit: false,
      }),
    ])
    expect(payload.nextCursor).toBe('project-viewer')
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 3,
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({
            workspaceId: null,
            user: expect.any(Object),
          }),
        ]),
      }),
      select: expect.not.objectContaining({
        novelPromotionData: expect.anything(),
        usageCosts: expect.anything(),
      }),
    }))
  })

  it('明確屬於其他 workspace 的專案不得被標成 legacy workspace owner', async () => {
    prismaMock.project.findMany.mockResolvedValue([
      projectRow({
        id: 'project-other-workspace',
        userId: 'user-2',
        workspaceId: 'workspace-other',
        collaborators: [{ role: 'viewer' }],
        workspace: {
          ownerEditorId: 'other-owner',
          members: [],
        },
        // Simulate the project owner also belonging to an unrelated legacy
        // workspace owned by the requester.
        user: { workspaceMemberships: [{ workspaceId: 'legacy-workspace' }] },
      }),
    ])
    const { GET } = await import('@/app/api/projects/options/route')
    const request = buildMockRequest({ path: '/api/projects/options', method: 'GET' })

    const response = await GET(request, { params: Promise.resolve({}) })
    const payload = await response.json() as { projects: Array<Record<string, unknown>> }

    expect(payload.projects[0]).toMatchObject({
      id: 'project-other-workspace',
      effectiveRole: 'viewer',
      canEdit: false,
    })
  })

  it('管理員 -> 不套 accessible OR，並標示所有專案可編輯', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'admin' })
    prismaMock.project.findMany.mockResolvedValue([
      projectRow({ id: 'project-any', userId: 'other-user' }),
    ])
    const { GET } = await import('@/app/api/projects/options/route')
    const request = buildMockRequest({ path: '/api/projects/options', method: 'GET' })

    const response = await GET(request, { params: Promise.resolve({}) })

    const payload = await response.json() as {
      projects: Array<Record<string, unknown>>
    }
    expect(payload.projects[0]).toMatchObject({
      id: 'project-any',
      effectiveRole: 'admin',
      canEdit: true,
    })
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null },
    }))
  })
})
