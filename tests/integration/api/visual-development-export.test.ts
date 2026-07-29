import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({ visualDevelopmentWorkspace: { findUnique: vi.fn() }, task: { findMany: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('visual development export API', () => {
  beforeEach(() => {
    vi.resetModules()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    prismaMock.task.findMany.mockResolvedValue([])
  })

  it('rejects an unsupported export scope before building an archive', async () => {
    const mod = await import('@/app/api/visual-development/[projectId]/export/route')
    const response = await mod.GET(buildMockRequest({
      path: '/api/visual-development/project-1/export?scope=unknown',
      method: 'GET',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('VISUAL_DEVELOPMENT_EXPORT_SCOPE_INVALID')
  })

  it('builds a full project archive with manifest and QA report', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', status: 'world_draft', worldVersion: 1,
      createdAt: new Date('2026-07-29T00:00:00.000Z'), updatedAt: new Date('2026-07-29T00:00:00.000Z'),
      project: { id: 'project-1', name: '序列三', description: null, createdAt: new Date('2026-07-29T00:00:00.000Z'), updatedAt: new Date('2026-07-29T00:00:00.000Z') },
      worldBible: {}, characters: [],
    })
    const mod = await import('@/app/api/visual-development/[projectId]/export/route')
    const response = await mod.GET(buildMockRequest({
      path: '/api/visual-development/project-1/export?scope=full', method: 'GET',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const archive = await JSZip.loadAsync(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(archive.file('00_ADMIN/project_manifest.json')).not.toBeNull()
    expect(archive.file('09_QA/export_report.json')).not.toBeNull()
  })
})
