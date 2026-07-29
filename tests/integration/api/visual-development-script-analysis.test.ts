import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentWorkspace: { findUnique: vi.fn(), update: vi.fn() },
  visualDevelopmentCharacter: { upsert: vi.fn() },
  task: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
const apiConfigMock = vi.hoisted(() => ({ resolveModelSelection: vi.fn() }))
const submitterMock = vi.hoisted(() => ({ submitTask: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)

const analysis = {
  id: 'SCRIPT-task-1', sourceId: 'source-1', status: 'review', sourceTitle: '序列三', sourceFormat: 'pasted', sourceLength: 1000,
  modelKey: 'atlascloud::gpt-5', analyzedAt: '2026-07-29T00:00:00.000Z', synopsis: '逃亡者揭開地下城真相。', themes: ['自由'],
  worldBible: {
    projectPremise: '封閉地下城。', visualThesis: '聖潔外觀包裹工業核心。', eraAndGeography: '末世地下城市。',
    societyAndFactions: '統治者、平民與反抗者。', technologyRules: '基因科技有代價。', colorScript: '象牙白對比暗紅。',
    materialRules: '陶瓷、鏽鐵與生物膜。', architectureLanguage: '哥德尖塔與管線。', cameraFormat: '2.39:1 低照度。', forbiddenElements: '現代電子產品。',
  },
  characters: [{
    code: 'SINO', name: '絲諾', aliases: ['白雪'], entityType: 'human', role: '女主角', narrativeFunction: '揭示世界。', apparentAge: '19',
    coreTraits: '溫柔而堅韌。', goal: '逃出地下城。', fear: '失去同伴。', secret: '', arc: '成為反抗核心。', relationships: '與休互信。',
    physicalNotes: '黑長髮。', firstAppearance: '平民區。', castingBrief: { ethnicity: '', faceStructure: '', emotionalRead: '克制決心。', lifeHistory: '很早被迫長大。' },
  }, {
    code: 'OWL', name: '夜梟', aliases: [], entityType: 'animal', role: '動物意象', narrativeFunction: '警示危險。', apparentAge: '未明示',
    coreTraits: '警覺。', goal: '跟隨絲諾。', fear: '強光。', secret: '', arc: '未明示。', relationships: '與絲諾連結。',
    physicalNotes: '白色羽毛。', firstAppearance: '逃亡段落。', castingBrief: { ethnicity: '', faceStructure: '', emotionalRead: '警覺。', lifeHistory: '野外生存。' },
  }],
  locations: [], confidenceNotes: ['動物是否為實體需確認。'], importedAt: null, importedCharacterCodes: [],
}

function workspace(status = 'world_draft') {
  return { id: 'workspace-1', projectId: 'project-1', status, worldVersion: 1, worldBible: { scriptAnalysis: analysis, sources: [{ id: 'source-1', key: 'documents/source.txt', originalKey: null, name: '序列三.txt', sourceTitle: '序列三', sourceFormat: 'pasted', mimeType: 'text/plain', sha256: 'abc', sizeBytes: 1200, textLength: 1000, createdAt: '2026-07-29T00:00:00.000Z' }] }, characters: [] }
}

describe('visual development screenplay analysis API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    apiConfigMock.resolveModelSelection.mockResolvedValue({ provider: 'atlascloud', modelId: 'gpt-5', modelKey: 'atlascloud::gpt-5' })
    submitterMock.submitTask.mockResolvedValue({ taskId: 'task-1', status: 'queued', deduped: false })
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue(workspace())
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      visualDevelopmentWorkspace: prismaMock.visualDevelopmentWorkspace,
      visualDevelopmentCharacter: prismaMock.visualDevelopmentCharacter,
    }))
  })

  it('submits the screenplay through the selected platform LLM', async () => {
    const mod = await import('@/app/api/visual-development/[projectId]/script-analysis/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1/script-analysis', method: 'POST',
      body: { sourceId: 'source-1', sourceTitle: '序列三', sourceFormat: 'pasted', modelKey: 'atlascloud::gpt-5', meta: { locale: 'zh' } },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(202)
    expect(submitterMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS,
      projectId: 'project-1',
      dedupeKey: expect.stringContaining('visual-development-script:v2:'),
      payload: expect.objectContaining({ sourceId: 'source-1', sourceKey: 'documents/source.txt', analysisModel: 'atlascloud::gpt-5', model: 'atlascloud::gpt-5' }),
    }))
  })

  it('does not surface an older failed task or analysis after a new source is uploaded', async () => {
    const nextWorkspace = workspace()
    nextWorkspace.worldBible.sources.push({
      id: 'source-2', key: 'documents/source-2.txt', originalKey: null, name: '序列三 V2.txt', sourceTitle: '序列三 V2',
      sourceFormat: 'pasted', mimeType: 'text/plain', sha256: 'def', sizeBytes: 1500, textLength: 1200, createdAt: '2026-07-29T01:00:00.000Z',
    })
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue(nextWorkspace)
    prismaMock.task.findMany.mockResolvedValue([{
      id: 'task-old', status: 'failed', progress: 70, errorCode: 'INTERNAL_ERROR',
      errorMessage: 'SCRIPT_ANALYSIS_INVALID: missing fear', createdAt: new Date('2026-07-29T00:30:00.000Z'),
      payload: { sourceId: 'source-1' },
    }])
    const mod = await import('@/app/api/visual-development/[projectId]/script-analysis/route')
    const response = await mod.GET(buildMockRequest({
      path: '/api/visual-development/project-1/script-analysis', method: 'GET',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.analysis).toBeNull()
    expect(body.data.task).toBeNull()
    expect(body.data.sources).toHaveLength(2)
  })

  it('refuses to overwrite a locked World Canon', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue(workspace('world_locked'))
    const mod = await import('@/app/api/visual-development/[projectId]/script-analysis/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/script-analysis', method: 'PATCH',
      body: { action: 'apply-analysis', applyWorldBible: true, characterCodes: ['SINO'] },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('WORLD_CANON_ALREADY_LOCKED')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('imports only approved characters and preserves the AI result as an applied audit record', async () => {
    const mod = await import('@/app/api/visual-development/[projectId]/script-analysis/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/script-analysis', method: 'PATCH',
      body: { action: 'apply-analysis', applyWorldBible: true, characterCodes: ['SINO'] },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    expect(prismaMock.visualDevelopmentCharacter.upsert).toHaveBeenCalledTimes(1)
    expect(prismaMock.visualDevelopmentCharacter.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ code: 'SINO', name: '絲諾' }),
    }))
    const worldUpdate = prismaMock.visualDevelopmentWorkspace.update.mock.calls[0]?.[0]
    expect(worldUpdate.data.status).toBe('world_draft')
    expect(worldUpdate.data.worldBible).toMatchObject({
      projectPremise: analysis.worldBible.projectPremise,
      scriptAnalysis: { status: 'applied', importedCharacterCodes: ['SINO'] },
    })
  })
})
