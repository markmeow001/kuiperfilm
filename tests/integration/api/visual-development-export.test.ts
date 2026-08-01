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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 })))
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

  it('exports the research canon and approved research evidence', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', status: 'world_draft', worldVersion: 1,
      createdAt: new Date('2026-07-29T00:00:00.000Z'), updatedAt: new Date('2026-07-29T00:00:00.000Z'),
      project: { id: 'project-1', name: '序列三', description: null, createdAt: new Date('2026-07-29T00:00:00.000Z'), updatedAt: new Date('2026-07-29T00:00:00.000Z') },
      worldBible: {
        research: {
          status: 'locked',
          references: [{
            id: 'reference-1',
            key: 'https://assets.example.com/casting.jpg',
            name: 'Casting Face Study',
            category: 'casting-face',
            usage: 'use',
            note: 'Bone structure reference',
            sourceUrl: 'https://source.example.com/casting',
            creator: 'Example Studio',
            license: '',
            rightsStatus: 'editorial-reference',
            reviewStatus: 'approved',
            rejectionNote: null,
            createdAt: '2026-07-29T00:00:00.000Z',
          }],
        },
      },
      characters: [],
    })
    const mod = await import('@/app/api/visual-development/[projectId]/export/route')
    const response = await mod.GET(buildMockRequest({
      path: '/api/visual-development/project-1/export?scope=canon', method: 'GET',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const archive = await JSZip.loadAsync(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(archive.file('02_WORLD_BIBLE/research/research_canon.json')).not.toBeNull()
    expect(archive.file('02_WORLD_BIBLE/research/references/casting-face/Casting Face Study.jpg')).not.toBeNull()
  })
})
