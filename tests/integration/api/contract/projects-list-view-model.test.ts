import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({ authenticated: true, userId: 'user-1' }))
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  workspace: { findUnique: vi.fn() },
  workspaceMember: { findUnique: vi.fn() },
  project: { count: vi.fn(), findMany: vi.fn() },
  usageCost: { groupBy: vi.fn() },
  novelPromotionProject: { findMany: vi.fn() },
  userProjectState: { findMany: vi.fn() },
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
    return { session: { user: { id: authState.userId } } }
  },
  roleAtLeast: (role: string | null | undefined, threshold: string) => (
    threshold === 'admin' ? role === 'admin' : false
  ),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-owned',
    name: 'Owned project',
    description: null,
    mode: 'novel-promotion',
    userId: 'user-1',
    workspaceId: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    lastAccessedAt: null,
    collaborators: [],
    workspace: null,
    user: { workspaceMemberships: [] },
    ...overrides,
  }
}

type ProjectViewModel = {
  id: string
  lastStep: string | null
  effectiveRole: string
  canEdit: boolean
  canDelete: boolean
}

async function getProjects(query?: Record<string, string>) {
  const { GET } = await import('@/app/api/projects/route')
  const request = buildMockRequest({
    path: '/api/projects',
    method: 'GET',
    query,
  })
  const response = await GET(request, { params: Promise.resolve({}) })
  return {
    response,
    payload: await response.json() as {
      projects: ProjectViewModel[]
      pagination: { total: number }
    },
  }
}

describe('GET /api/projects list view-model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    authState.userId = 'user-1'
    prismaMock.user.findUnique.mockResolvedValue({ role: 'member' })
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      ownerEditorId: 'workspace-owner',
    })
    prismaMock.workspaceMember.findUnique.mockResolvedValue({ workspaceId: 'workspace-1' })
    prismaMock.project.count.mockResolvedValue(0)
    prismaMock.project.findMany.mockResolvedValue([])
    prismaMock.usageCost.groupBy.mockResolvedValue([])
    prismaMock.novelPromotionProject.findMany.mockResolvedValue([])
    prismaMock.userProjectState.findMany.mockResolvedValue([])
  })

  it('個人範圍的專案 -> 回傳 owner 權限與該使用者的合法 lastStep', async () => {
    prismaMock.project.count.mockResolvedValue(1)
    prismaMock.project.findMany.mockResolvedValue([projectRow()])
    prismaMock.userProjectState.findMany.mockResolvedValue([
      { projectId: 'project-owned', lastStep: 'storyboard' },
    ])

    const { response, payload } = await getProjects()

    expect(response.status).toBe(200)
    expect(payload.projects).toEqual([
      expect.objectContaining({
        id: 'project-owned',
        lastStep: 'storyboard',
        effectiveRole: 'owner',
        canEdit: true,
        canDelete: true,
      }),
    ])
    expect(payload.projects[0]).not.toHaveProperty('collaborators')
    expect(payload.projects[0]).not.toHaveProperty('workspace')
    expect(payload.projects[0]).not.toHaveProperty('user')
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-1', deletedAt: null }),
      include: expect.objectContaining({
        collaborators: expect.any(Object),
        workspace: expect.any(Object),
        user: expect.any(Object),
      }),
    }))
    expect(prismaMock.userProjectState.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        projectId: { in: ['project-owned'] },
      },
      select: { projectId: true, lastStep: true },
    })
  })

  it('工作區範圍的協作者與成員 -> 依 access cascade 標示 editor/viewer，viewer 不可刪除', async () => {
    prismaMock.project.count.mockResolvedValue(3)
    prismaMock.project.findMany.mockResolvedValue([
      projectRow({
        id: 'project-collab-editor',
        userId: 'user-2',
        workspaceId: 'workspace-1',
        collaborators: [{ role: 'editor' }],
        workspace: {
          ownerEditorId: 'workspace-owner',
          members: [{ role: 'viewer' }],
        },
      }),
      projectRow({
        id: 'project-collab-viewer',
        userId: 'user-3',
        workspaceId: 'workspace-1',
        collaborators: [{ role: 'viewer' }],
        workspace: {
          ownerEditorId: 'workspace-owner',
          members: [{ role: 'editor' }],
        },
      }),
      projectRow({
        id: 'project-workspace-editor',
        userId: 'user-4',
        workspaceId: 'workspace-1',
        workspace: {
          ownerEditorId: 'workspace-owner',
          members: [{ role: 'editor' }],
        },
      }),
    ])
    prismaMock.userProjectState.findMany.mockResolvedValue([
      { projectId: 'project-collab-editor', lastStep: 'voice' },
      { projectId: 'project-collab-viewer', lastStep: 'not-a-real-step' },
    ])

    const { payload } = await getProjects({ ws: 'workspace-1' })

    expect(payload.projects).toEqual([
      expect.objectContaining({
        id: 'project-collab-editor',
        lastStep: 'voice',
        effectiveRole: 'editor',
        canEdit: true,
        canDelete: true,
      }),
      expect.objectContaining({
        id: 'project-collab-viewer',
        lastStep: null,
        effectiveRole: 'viewer',
        canEdit: false,
        canDelete: false,
      }),
      expect.objectContaining({
        id: 'project-workspace-editor',
        lastStep: null,
        effectiveRole: 'editor',
        canEdit: true,
        canDelete: true,
      }),
    ])
  })

  it('管理員查看工作區專案 -> owner 仍優先，其餘專案標示 admin 並可刪除', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'admin' })
    prismaMock.project.count.mockResolvedValue(2)
    prismaMock.project.findMany.mockResolvedValue([
      projectRow({ id: 'project-owned-admin', workspaceId: 'workspace-1' }),
      projectRow({
        id: 'project-other',
        userId: 'user-2',
        workspaceId: 'workspace-1',
      }),
    ])

    const { payload } = await getProjects({ ws: 'workspace-1' })

    expect(payload.projects).toEqual([
      expect.objectContaining({
        id: 'project-owned-admin',
        effectiveRole: 'owner',
        canDelete: true,
      }),
      expect.objectContaining({
        id: 'project-other',
        effectiveRole: 'admin',
        canDelete: true,
      }),
    ])
  })

  it('沒有專案 -> 回傳空陣列，進度查詢仍維持單次批次契約', async () => {
    const { payload } = await getProjects()

    expect(payload.projects).toEqual([])
    expect(payload.pagination.total).toBe(0)
    expect(prismaMock.userProjectState.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        projectId: { in: [] },
      },
      select: { projectId: true, lastStep: true },
    })
  })
})
