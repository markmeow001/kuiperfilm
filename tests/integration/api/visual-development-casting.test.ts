import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentWorkspace: { findUnique: vi.fn() },
  visualDevelopmentCharacter: { upsert: vi.fn() },
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
