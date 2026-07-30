import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const mocks = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
  reportTaskProgress: vi.fn(),
  assertTaskActive: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: mocks.executeAiTextStep }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: mocks.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: mocks.assertTaskActive }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    visualDevelopmentCharacter: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}))

import { handleVisualDevelopmentStageBriefTask } from '@/lib/workers/handlers/visual-development-stage-brief'

const analysisCharacter = {
  code: 'CHR-SNO',
  name: '絲諾',
  aliases: [],
  entityType: 'human',
  role: '主角',
  narrativeFunction: '揭露地下城制度',
  apparentAge: '19',
  coreTraits: '溫柔、警覺、堅韌',
  goal: '帶同伴逃離地下城',
  fear: '失去同伴',
  secret: '',
  arc: '從受保護者成為反抗核心',
  relationships: '與休逐步互信',
  physicalNotes: '黑長髮、精瘦',
  firstAppearance: '平民區逃亡',
  castingBrief: {
    ethnicity: '',
    faceStructure: '',
    emotionalRead: '克制的恐懼與決心',
    lifeHistory: '被迫快速長大',
  },
} as const

const scriptAnalysis = {
  id: 'SCRIPT-analysis-1',
  sourceId: 'source-1',
  status: 'applied',
  sourceTitle: '序列三',
  sourceFormat: 'pasted',
  sourceLength: 1600,
  modelKey: 'openrouter::gemini-3.1-pro',
  analyzedAt: '2026-07-29T00:00:00.000Z',
  synopsis: '地下城逃亡者揭開制度真相。',
  themes: ['自由與控制'],
  worldBible: {
    projectPremise: '封閉地下城。',
    visualThesis: '聖潔外觀包裹工業核心。',
    eraAndGeography: '末世地下城市。',
    societyAndFactions: '統治者、平民與反抗者。',
    technologyRules: '基因科技有代價。',
    colorScript: '象牙白對比暗紅。',
    materialRules: '陶瓷、鏽鐵與生物膜。',
    architectureLanguage: '哥德尖塔與管線。',
    cameraFormat: '2.39:1 低照度。',
    forbiddenElements: '現代電子產品。',
  },
  characters: [analysisCharacter],
  locations: [{
    name: '平民區',
    narrativeFunction: '角色逃亡起點',
    visualEvidence: '狹窄金屬艙室、鏽蝕管線與廉價暖光',
  }],
  confidenceNotes: [],
  importedAt: '2026-07-29T01:00:00.000Z',
  importedCharacterCodes: ['CHR-SNO'],
} as const

function job(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-brief-1',
      type: TASK_TYPE.VISUAL_DEVELOPMENT_STAGE_BRIEF,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'visual-development-stage-brief',
      targetId: 'character-1:costume',
      userId: 'user-1',
      payload: {
        characterId: 'character-1',
        characterCode: 'CHR-SNO',
        stageId: 'costume',
        analysisModel: 'openrouter::gemini-3.1-pro',
      },
    },
  } as unknown as Job<TaskJobData>
}

describe('visual development production-stage brief task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reportTaskProgress.mockResolvedValue(undefined)
    mocks.assertTaskActive.mockResolvedValue(undefined)
    mocks.findFirst.mockResolvedValue({
      id: 'character-1',
      code: 'CHR-SNO',
      name: '絲諾',
      characterDna: { role: '主角', coreTraits: '溫柔且堅韌' },
      workspace: {
        projectId: 'project-1',
        worldBible: {
          ...scriptAnalysis.worldBible,
          scriptAnalysis,
        },
      },
    })
    mocks.findUnique.mockResolvedValue({
      characterDna: { role: '主角', coreTraits: '溫柔且堅韌' },
    })
    mocks.update.mockResolvedValue({ id: 'character-1' })
    mocks.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        summary: '以可活動的修長層次與地下工業磨損呈現受保護者轉為逃亡者。',
        fields: {
          silhouetteSystem: '修長但不華麗的多層輪廓，肩線收斂並保留奔跑空間。',
          materialConstruction: '舊羊毛、磨損皮革與少量暗銀固定件，接縫可實際製作。',
          storyWear: '袖口與下襬因管道逃亡磨損，修補位置必須有劇情原因。',
        },
        evidence: ['角色從平民區進入管道逃亡。'],
        constraints: ['不得改變 Face ID、Hair ID 或世界觀材質規則。'],
      }),
      reasoning: '',
    })
  })

  it('uses the screenplay analysis model and persists one immutable stage baseline', async () => {
    const result = await handleVisualDevelopmentStageBriefTask(job())

    expect(mocks.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openrouter::gemini-3.1-pro',
      action: 'visual_development_stage_brief',
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('CADS Phase 04') }),
      ]),
    }))
    const write = mocks.update.mock.calls[0]?.[0]
    const serialized = write.data.characterDna.stageBrief_costume as string
    expect(JSON.parse(serialized)).toMatchObject({
      version: 1,
      stageId: 'costume',
      characterCode: 'CHR-SNO',
      sourceAnalysisId: 'SCRIPT-analysis-1',
      fields: {
        silhouetteSystem: expect.stringContaining('多層輪廓'),
      },
    })
    expect(result).toMatchObject({ success: true, stageId: 'costume', briefVersion: 1 })
  })

  it('does not persist incomplete model output', async () => {
    mocks.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        summary: 'incomplete',
        fields: { silhouetteSystem: 'only one field' },
        evidence: ['evidence'],
        constraints: ['constraint'],
      }),
      reasoning: '',
    })

    await expect(handleVisualDevelopmentStageBriefTask(job())).rejects.toThrow(/materialConstruction/)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses to replace an existing immutable baseline', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'character-1',
      code: 'CHR-SNO',
      name: '絲諾',
      characterDna: { stageBrief_costume: '{"version":1}' },
      workspace: { projectId: 'project-1', worldBible: { scriptAnalysis } },
    })

    await expect(handleVisualDevelopmentStageBriefTask(job())).rejects.toThrow(/immutable costume brief already exists/)
    expect(mocks.executeAiTextStep).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
