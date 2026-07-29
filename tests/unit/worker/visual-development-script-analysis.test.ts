import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const mocks = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
  reportTaskProgress: vi.fn(),
  assertTaskActive: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: mocks.executeAiTextStep }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: mocks.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: mocks.assertTaskActive }))
vi.mock('@/lib/cos', () => ({ getSignedUrl: (key: string) => `https://storage.test/${key}`, toFetchableUrl: (url: string) => url }))
vi.mock('@/lib/prisma', () => ({ prisma: { visualDevelopmentWorkspace: {
  findUnique: mocks.findUnique,
  upsert: mocks.upsert,
} } }))

import { handleVisualDevelopmentScriptAnalysisTask } from '@/lib/workers/handlers/visual-development-script-analysis'
import { parseStoredScriptAnalysis } from '@/lib/visual-development/script-analysis'

const modelResult = {
  synopsis: '地下城逃亡者揭開制度真相。', themes: ['自由與控制'],
  worldBible: {
    projectPremise: '封閉地下城。', visualThesis: '聖潔外觀包裹工業核心。', eraAndGeography: '末世地下城市。',
    societyAndFactions: '統治者、平民與反抗者。', technologyRules: '基因科技有代價。', colorScript: '象牙白對比暗紅。',
    materialRules: '陶瓷、鏽鐵與生物膜。', architectureLanguage: '哥德尖塔與管線。', cameraFormat: '2.39:1 低照度。', forbiddenElements: '現代電子產品。',
  },
  characters: [{
    code: 'SINO', name: '絲諾', aliases: [], entityType: 'human', role: '女主角', narrativeFunction: '揭示世界。', apparentAge: '19',
    coreTraits: '溫柔而堅韌。', goal: '逃出地下城。', fear: '失去同伴。', secret: '', arc: '成為反抗核心。', relationships: '與休互信。',
    physicalNotes: '黑長髮。', firstAppearance: '平民區。', castingBrief: { ethnicity: '', faceStructure: '', emotionalRead: '克制決心。', lifeHistory: '很早被迫長大。' },
  }],
  locations: [], confidenceNotes: ['族裔未明示。'],
}

function job(): Job<TaskJobData> {
  return { data: {
    taskId: 'task-1', type: TASK_TYPE.VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS, locale: 'zh', projectId: 'project-1',
    targetType: 'VisualDevelopmentWorkspace', targetId: 'project-1', userId: 'user-1',
    payload: { sourceId: 'source-1', sourceKey: 'documents/source.txt', sourceSha256: '74201609edb329da165aeed57fb7198c7201db5ce57de8c9e2fd1c6e10f562cd', sourceTitle: '序列三', sourceFormat: 'pasted', analysisModel: 'atlascloud::analysis-model' },
  } } as unknown as Job<TaskJobData>
}

describe('visual development screenplay analysis task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reportTaskProgress.mockResolvedValue(undefined)
    mocks.assertTaskActive.mockResolvedValue(undefined)
    mocks.findUnique.mockResolvedValue(null)
    mocks.upsert.mockResolvedValue({ id: 'workspace-1' })
    mocks.executeAiTextStep.mockResolvedValue({ text: JSON.stringify(modelResult), reasoning: '' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('劇本內容。'.repeat(160), { status: 200 })))
  })

  it('uses the selected LLM and persists a review draft without locking Canon', async () => {
    const result = await handleVisualDevelopmentScriptAnalysisTask(job())
    expect(mocks.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({ model: 'atlascloud::analysis-model', action: 'visual_development_script_analysis' }))
    const write = mocks.upsert.mock.calls[0]?.[0]
    expect(write.create.worldBible.scriptAnalysis).toMatchObject({ status: 'review', modelKey: 'atlascloud::analysis-model' })
    expect(write.update).not.toHaveProperty('status')
    expect(result).toMatchObject({ success: true, characterCount: 1 })
  })

  it('does not persist malformed model output', async () => {
    mocks.executeAiTextStep.mockResolvedValue({ text: 'not json', reasoning: '' })
    await expect(handleVisualDevelopmentScriptAnalysisTask(job())).rejects.toThrow(/did not return JSON/)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('keeps an analyzable draft when the model omits reviewable character fields', async () => {
    const incompleteResult = structuredClone(modelResult)
    const incompleteCharacter = incompleteResult.characters[0] as Record<string, unknown>
    delete incompleteCharacter.fear
    delete incompleteCharacter.relationships
    incompleteCharacter.entityType = 'unsupported-value'
    mocks.executeAiTextStep.mockResolvedValue({ text: JSON.stringify(incompleteResult), reasoning: '' })

    await expect(handleVisualDevelopmentScriptAnalysisTask(job())).resolves.toMatchObject({
      success: true,
      characterCount: 1,
    })

    const analysis = mocks.upsert.mock.calls[0]?.[0].create.worldBible.scriptAnalysis
    expect(analysis.characters[0]).toMatchObject({ fear: '', relationships: '', entityType: 'unknown' })
    expect(analysis.confidenceNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('characters[0].fear'),
      expect.stringContaining('characters[0].relationships'),
      expect.stringContaining('characters[0].entityType'),
    ]))
    const restored = parseStoredScriptAnalysis(analysis)
    expect(restored?.confidenceNotes.filter((note) => note.includes('characters[0].fear'))).toHaveLength(1)
  })

  it('rejects a short screenplay before calling the model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('short', { status: 200 })))
    await expect(handleVisualDevelopmentScriptAnalysisTask(job())).rejects.toThrow(/at least 500/)
    expect(mocks.executeAiTextStep).not.toHaveBeenCalled()
  })
})
