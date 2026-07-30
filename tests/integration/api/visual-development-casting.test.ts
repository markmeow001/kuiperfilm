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

const completeWorldBible = {
  projectPremise: 'An underground city survives by consuming biological energy.',
  visualThesis: 'Sacred order conceals industrial predation.',
  eraAndGeography: 'A sealed subterranean metropolis.',
  societyAndFactions: 'Religious rulers, workers, and hidden dissidents.',
  technologyRules: 'Steam infrastructure fused with gene technology.',
  colorScript: 'Ivory authority above soot and brass workers.',
  materialRules: 'Metals oxidize and biological membranes remain damp.',
  architectureLanguage: 'Vertical gothic authority over circular industry.',
  cameraFormat: 'Restrained lenses and motivated practical light.',
  forbiddenElements: 'No decorative fantasy magic.',
}

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
    prismaMock.visualDevelopmentBatch.create.mockImplementation(async (args: { data: { candidates: { create: Array<Record<string, unknown>> } } }) => ({
      id: 'batch-1',
      candidates: args.data.candidates.create.map((candidate, index) => ({ ...candidate, id: `candidate-${index + 1}` })),
    }))
    prismaMock.visualDevelopmentBatch.update.mockResolvedValue({})
    prismaMock.visualDevelopmentCandidate.update.mockResolvedValue({})
    prismaMock.visualDevelopmentCandidate.updateMany.mockResolvedValue({ count: 0 })
    submitterMock.submitTask.mockImplementation(async (input: { targetId: string }) => ({ taskId: `task-${input.targetId}`, status: 'queued' }))
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

  it('rejects attempts to overwrite an immutable screenplay stage brief through draft autosave', async () => {
    const mod = await import('@/app/api/visual-development/[projectId]/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1', method: 'PATCH',
      body: {
        action: 'save-draft',
        characterCode: 'SINO',
        characterDnaPatch: { stageBrief_costume: '{"summary":"client override"}' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('IMMUTABLE_STAGE_BRIEF')
    expect(prismaMock.visualDevelopmentCharacter.update).not.toHaveBeenCalled()
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

  it('角色可保留 18 歲銀幕年齡，並以 21+ 成年演員建立 FLUX.2 Pro 候選', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', status: 'world_locked', worldBible: completeWorldBible,
    })
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud', modelId: 'flux-2-pro', modelKey: 'atlascloud::flux-2-pro',
    })
    const mod = await import('@/app/api/visual-development/[projectId]/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1',
      method: 'POST',
      body: {
        characterDna: { role: 'lead', coreTraits: 'quietly resilient' },
        castingBrief: { apparentAge: '18', performerAge: '21+', emotionalRead: 'guarded' },
        characterCode: 'SINO',
        characterName: '絲諾',
        modelKey: 'atlascloud::flux-2-pro',
        candidateCount: 4,
        meta: { locale: 'zh' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.data.submitted).toBe(4)
    expect(prismaMock.visualDevelopmentBatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ aspectRatio: '3:4' }),
    }))
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(4)
    const first = submitterMock.submitTask.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(first.payload.aspectRatio).toBe('3:4')
    expect(first.payload.prompt).toContain('Screen role age: 18')
    expect(first.payload.prompt).toContain('Adult performer age: 21+')
  })

  it('成年演員年齡低於 21 時提供明確錯誤，不送往模型', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', status: 'world_locked', worldBible: completeWorldBible,
    })
    const mod = await import('@/app/api/visual-development/[projectId]/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1',
      method: 'POST',
      body: {
        characterDna: { role: 'lead', coreTraits: 'quietly resilient' },
        castingBrief: { apparentAge: '18', performerAge: '18', emotionalRead: 'guarded' },
        characterCode: 'SINO', characterName: '絲諾',
        modelKey: 'atlascloud::flux-2-pro', candidateCount: 4, meta: { locale: 'zh' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('CASTING_ADULT_PERFORMER_AGE_REQUIRED')
    expect(body.error.details.field).toBe('castingBrief.performerAge')
    expect(body.error.message).toContain('21 歲以上')
    expect(apiConfigMock.resolveModelSelection).not.toHaveBeenCalled()
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })
})
