import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentWorkspace: { findUnique: vi.fn(), upsert: vi.fn() },
  visualDevelopmentCharacter: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  visualDevelopmentBatch: { create: vi.fn(), update: vi.fn() },
  visualDevelopmentCandidate: { update: vi.fn(), updateMany: vi.fn() },
}))
const apiConfigMock = vi.hoisted(() => ({ resolveModelSelection: vi.fn() }))
const submitterMock = vi.hoisted(() => ({ submitTask: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)

describe('POST /api/visual-development/[projectId] Casting gate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    prismaMock.visualDevelopmentWorkspace.upsert.mockResolvedValue({ id: 'workspace-1', projectId: 'project-1' })
    prismaMock.visualDevelopmentCharacter.upsert.mockResolvedValue({ id: 'character-1', code: 'SINO' })
  })

  it('autosaves character drafts without replacing the World Bible', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({ id: 'workspace-1', projectId: 'project-1', status: 'world_locked', worldBible: { projectPremise: 'Canon' } })
    prismaMock.visualDevelopmentCharacter.findUnique.mockResolvedValue({ characterDna: { role: 'lead', aliases: ['Snow'] }, castingBrief: { apparentAge: '24' } })
    const mod = await import('@/app/api/visual-development/[projectId]/route')
    const response = await mod.PUT(buildMockRequest({
      path: '/api/visual-development/project-1', method: 'PUT',
      body: { characterCode: 'SINO', characterName: '絲諾', characterDna: { coreTraits: 'quietly resilient' }, castingBrief: { emotionalRead: 'restrained' } },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    expect(prismaMock.visualDevelopmentWorkspace.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }))
    expect(prismaMock.visualDevelopmentCharacter.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ characterDna: { role: 'lead', aliases: ['Snow'], coreTraits: 'quietly resilient' } }),
    }))
  })

  it('merges downstream stage drafts into the active character record', async () => {
    prismaMock.visualDevelopmentCharacter.findFirst.mockResolvedValue({ id: 'character-1', code: 'SINO', characterDna: { role: 'lead', aliases: ['Snow'] } })
    prismaMock.visualDevelopmentCharacter.update.mockResolvedValue({ id: 'character-1', code: 'SINO', updatedAt: new Date() })
    const mod = await import('@/app/api/visual-development/[projectId]/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1', method: 'PATCH',
      body: { action: 'save-draft', characterCode: 'SINO', characterDnaPatch: { hairSilhouette: 'sharp owl-wing contour' } },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    expect(prismaMock.visualDevelopmentCharacter.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { characterDna: { role: 'lead', aliases: ['Snow'], hairSilhouette: 'sharp owl-wing contour' } },
    }))
  })

  it('World Canon 尚未鎖定 -> 不得建立 Casting 或送出生圖任務', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', status: 'world_draft', worldBible: {},
    })
    const mod = await import('@/app/api/visual-development/[projectId]/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1',
      method: 'POST',
      body: {
        worldBible: { projectPremise: 'untrusted client draft', visualThesis: 'untrusted client draft' },
        characterDna: { role: 'lead', coreTraits: 'restrained' },
        castingBrief: { apparentAge: '24–28', emotionalRead: 'guarded' },
        characterCode: 'CHR-01',
        characterName: 'Sino',
        modelKey: 'atlascloud::flux-2-pro',
        candidateCount: 10,
        meta: { locale: 'zh' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('WORLD_CANON_REQUIRED')
    expect(prismaMock.visualDevelopmentCharacter.upsert).not.toHaveBeenCalled()
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })
})
