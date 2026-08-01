import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'
import { getProductionStage, type ProductionStageId } from '@/lib/visual-development/production-stages'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentCharacter: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  visualDevelopmentCandidate: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  visualDevelopmentBatch: {
    create: vi.fn(),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(async (input: unknown) => {
    if (typeof input === 'function') return await (input as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    return input
  }),
}))

const apiConfigMock = vi.hoisted(() => ({ resolveModelSelection: vi.fn() }))
const submitterMock = vi.hoisted(() => ({ submitTask: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)

function request(stageId: ProductionStageId, modelKey: string, aspectRatio = stageId === 'video' ? '16:9' : '3:4') {
  return buildMockRequest({
    path: `/api/visual-development/project-1/stages/${stageId}`,
    method: 'POST',
    body: {
      characterCode: 'CHR-SNO',
      modelKey,
      aspectRatio,
      duration: 5,
      creativePrompt: 'Reduce decorative clutter while preserving the screenplay baseline.',
      meta: { locale: 'zh' },
    },
  })
}

function storedBrief(stageId: ProductionStageId) {
  const fields = Object.fromEntries(
    getProductionStage(stageId).fields.map((field) => [field, `${stageId} screenplay direction for ${field}`]),
  )
  return JSON.stringify({
    version: 1,
    stageId,
    characterCode: 'CHR-SNO',
    modelKey: 'openrouter::gemini-3.1-pro',
    createdAt: '2026-07-30T00:00:00.000Z',
    sourceAnalysisId: 'SCRIPT-analysis-1',
    summary: `Immutable ${stageId} direction derived from the screenplay.`,
    fields,
    evidence: ['The screenplay establishes the character as a guarded underground fugitive.'],
    constraints: ['Preserve locked identity, hair, class, and story state.'],
  })
}

function installFixtures(status = 'hair_locked') {
  const characterDna = {
    role: 'protagonist',
    coreTraits: 'guarded and determined',
    faceBibleBatchId: 'face-lock-batch-1',
    hairBibleBatchId: 'hair-validation-batch-1',
    hairDirectionCandidateId: 'hair-1',
    accessoryBatchId: 'accessory-batch-1',
    accessoryPrimaryCandidateId: 'accessory-1',
    integrationBatchId: 'integration-batch-1',
    integrationPrimaryCandidateId: 'integration-1',
    stageBrief_costume: storedBrief('costume'),
    stageBrief_expression: storedBrief('expression'),
    stageBrief_turnaround: storedBrief('turnaround'),
    stageBrief_video: storedBrief('video'),
  }
  prismaMock.visualDevelopmentCharacter.findFirst.mockResolvedValue({
    id: 'character-1',
    code: 'CHR-SNO',
    status,
    characterDna,
    castingBrief: { apparentAge: '24–28' },
    workspace: { id: 'workspace-1', projectId: 'project-1', worldBible: { projectPremise: 'underground city', visualThesis: 'sacred order hides predation' } },
  })
  prismaMock.visualDevelopmentCharacter.findUnique.mockResolvedValue({ status, characterDna })
  prismaMock.visualDevelopmentBatch.findFirst.mockResolvedValue({
    id: 'hair-validation-batch-1',
    promptStack: { sourceHairCandidateId: 'hair-1' },
  })
  prismaMock.visualDevelopmentCandidate.findFirst.mockImplementation(async (args: { where: { batch: { stage: string } } }) => {
    const stage = args.where.batch.stage
    if (stage === 'face-lock') return { id: 'face-1', taskId: 'face-task-1', code: 'EXPR-RESTRAINED' }
    if (stage === 'hair-exploration') return { id: 'hair-1', taskId: 'hair-task-1', code: 'HAIR-LONG-CENTER', isCanon: true }
    if (stage === 'phase-05-accessory') return { id: 'accessory-1', taskId: 'accessory-task-1', code: 'PROP-WORN' }
    if (stage === 'phase-12-integration') return { id: 'integration-1', taskId: 'integration-task-1', code: 'INT-WIDE', isCanon: true }
    return null
  })
  prismaMock.task.findFirst.mockImplementation(async (args: { where: { id: string } }) => ({
    result: { resultUrls: [`images/visual-development/${args.where.id}.png`] },
  }))
  prismaMock.visualDevelopmentBatch.create.mockImplementation(async (args: { data: { stage: string; candidates: { create: Array<Record<string, unknown>> } } }) => ({
    id: `${args.data.stage}-batch-1`,
    candidateCount: args.data.candidates.create.length,
    candidates: args.data.candidates.create.map((candidate, index) => ({ ...candidate, id: `${args.data.stage}-candidate-${index + 1}` })),
  }))
  submitterMock.submitTask.mockImplementation(async (input: { targetId: string }) => ({ taskId: `task-${input.targetId}`, status: 'queued' }))
}

describe('production stage API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    installFixtures()
  })

  it('rejects an image model that cannot consume the two Canon references', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({ provider: 'atlascloud', modelId: 'flux-kontext-pro', modelKey: 'atlascloud::flux-kontext-pro' })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.POST(request('costume', 'atlascloud::flux-kontext-pro'), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('STAGE_MULTI_REFERENCE_MODEL_REQUIRED')
    expect(prismaMock.visualDevelopmentBatch.create).not.toHaveBeenCalled()
  })

  it('creates four costume assets with separate identity and upstream design authorities', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({ provider: 'atlascloud', modelId: 'flux-2-pro', modelKey: 'atlascloud::flux-2-pro' })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.POST(request('costume', 'atlascloud::flux-2-pro'), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.data.submitted).toBe(4)
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(4)
    const first = submitterMock.submitTask.mock.calls[0]?.[0] as { type: string; payload: Record<string, unknown> }
    expect(first.type).toBe('visual_development_image')
    expect(first.payload.referenceImages).toEqual([
      'images/visual-development/face-task-1.png',
      'images/visual-development/hair-task-1.png',
    ])
    expect(first.payload.prompt).toContain('Reference image 1 is the locked Face ID and identity only')
    expect(first.payload.prompt).toContain('Reference image 2 is the locked Hair ID')
    expect(first.payload.prompt).toContain('Immutable screenplay-derived stage baseline')
    expect(first.payload.prompt).toContain('Reduce decorative clutter')
    expect(first.payload.prompt).toContain('no separate negative-prompt channel')
    expect(prismaMock.visualDevelopmentBatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        promptStack: expect.objectContaining({
          stageBrief: expect.objectContaining({
            stageId: 'costume',
            sourceAnalysisId: 'SCRIPT-analysis-1',
          }),
          creativePrompt: 'Reduce decorative clutter while preserving the screenplay baseline.',
        }),
      }),
    }))
    expect(prismaMock.visualDevelopmentCharacter.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        characterDna: expect.objectContaining({
          draft_costume_creativePrompt: 'Reduce decorative clutter while preserving the screenplay baseline.',
        }),
      },
    }))
  })

  it('uses the approved worn-design authority for Phase 7 instead of feeding the silhouette image into expressions', async () => {
    installFixtures('silhouette_locked')
    apiConfigMock.resolveModelSelection.mockResolvedValue({ provider: 'atlascloud', modelId: 'flux-2-pro', modelKey: 'atlascloud::flux-2-pro' })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.POST(request('expression', 'atlascloud::flux-2-pro'), { params: Promise.resolve({ projectId: 'project-1', stageId: 'expression' }) })

    expect(response.status).toBe(202)
    const first = submitterMock.submitTask.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(first.payload.referenceImages).toEqual([
      'images/visual-development/face-task-1.png',
      'images/visual-development/accessory-task-1.png',
    ])
    expect(first.payload.prompt).toContain('Change only the requested screenplay-driven micro-expression')
    expect(prismaMock.visualDevelopmentBatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ negativePrompt: expect.stringContaining('generic sad stare') }),
    }))
    expect(prismaMock.visualDevelopmentCandidate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        code: 'PROP-WORN',
        batch: expect.objectContaining({ id: 'accessory-batch-1', stage: 'phase-05-accessory' }),
      }),
    }))
  })

  it('rejects generation when the immutable screenplay baseline has not been created', async () => {
    prismaMock.visualDevelopmentCharacter.findFirst.mockResolvedValue({
      id: 'character-1',
      code: 'CHR-SNO',
      status: 'hair_locked',
      characterDna: { role: 'protagonist' },
      castingBrief: {},
      workspace: { id: 'workspace-1', projectId: 'project-1', worldBible: {} },
    })
    apiConfigMock.resolveModelSelection.mockResolvedValue({ provider: 'atlascloud', modelId: 'flux-2-pro', modelKey: 'atlascloud::flux-2-pro' })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.POST(request('costume', 'atlascloud::flux-2-pro'), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('STAGE_BRIEF_REQUIRED')
    expect(prismaMock.visualDevelopmentBatch.create).not.toHaveBeenCalled()
  })

  it('queues a stage-specific screenplay baseline with the original analysis model', async () => {
    prismaMock.visualDevelopmentCharacter.findFirst.mockResolvedValue({
      id: 'character-1',
      code: 'CHR-SNO',
      status: 'hair_locked',
      characterDna: { role: 'protagonist' },
      workspace: {
        id: 'workspace-1',
        projectId: 'project-1',
        worldBible: {
          scriptAnalysis: {
            id: 'SCRIPT-analysis-1',
            sourceId: 'source-1',
            status: 'applied',
            sourceTitle: '序列三',
            sourceFormat: 'pasted',
            sourceLength: 1200,
            modelKey: 'openrouter::gemini-3.1-pro',
            analyzedAt: '2026-07-29T00:00:00.000Z',
            synopsis: '地下城逃亡者揭開制度真相。',
            themes: [],
            worldBible: {},
            characters: [{
              code: 'CHR-SNO',
              name: '絲諾',
              aliases: [],
              entityType: 'human',
              role: '主角',
              narrativeFunction: '揭示制度真相',
              apparentAge: '19',
              coreTraits: '溫柔且堅韌',
              goal: '逃離地下城',
              fear: '失去同伴',
              secret: '',
              arc: '成為反抗核心',
              relationships: '與休互信',
              physicalNotes: '黑長髮',
              firstAppearance: '平民區',
              castingBrief: { ethnicity: '', faceStructure: '', emotionalRead: '克制', lifeHistory: '很早被迫長大' },
            }],
            locations: [],
            confidenceNotes: [],
            importedAt: '2026-07-29T01:00:00.000Z',
            importedCharacterCodes: ['CHR-SNO'],
          },
        },
      },
    })
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'openrouter',
      modelId: 'google/gemini-3.1-pro',
      modelKey: 'openrouter::gemini-3.1-pro',
    })
    submitterMock.submitTask.mockResolvedValue({ taskId: 'brief-task-1', status: 'queued' })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1/stages/costume',
      method: 'POST',
      body: {
        action: 'create-stage-brief',
        characterCode: 'CHR-SNO',
        meta: { locale: 'zh' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })

    expect(response.status).toBe(202)
    expect(apiConfigMock.resolveModelSelection).toHaveBeenCalledWith(
      'user-1',
      'openrouter::gemini-3.1-pro',
      'llm',
    )
    expect(submitterMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      type: 'visual_development_stage_brief',
      targetId: 'character-1:costume',
      payload: expect.objectContaining({
        stageId: 'costume',
        analysisModel: 'openrouter::gemini-3.1-pro',
      }),
    }))
  })

  it('creates four Phase 13 motion tests with a selectable video model and one scene reference', async () => {
    installFixtures('integration_locked')
    apiConfigMock.resolveModelSelection.mockResolvedValue({ provider: 'atlascloud', modelId: 'seedance-2.0-r2v', modelKey: 'atlascloud::seedance-2.0-r2v' })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.POST(request('video', 'atlascloud::seedance-2.0-r2v'), { params: Promise.resolve({ projectId: 'project-1', stageId: 'video' }) })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.data.submitted).toBe(4)
    const first = submitterMock.submitTask.mock.calls[0]?.[0] as { type: string; projectId: string; payload: Record<string, unknown> }
    expect(first.type).toBe('playground_video')
    expect(first.projectId).toBe('project-1')
    expect(first.payload.referenceImages).toEqual(['images/visual-development/integration-task-1.png'])
    expect(first.payload.duration).toBe(5)
    expect(first.payload.prompt).toContain('approved first-frame identity')
  })

  it('accepts a portrait ratio registered by the selected Seedance R2V model', async () => {
    installFixtures('integration_locked')
    apiConfigMock.resolveModelSelection.mockResolvedValue({ provider: 'atlascloud', modelId: 'seedance-2.0-r2v', modelKey: 'atlascloud::seedance-2.0-r2v' })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.POST(request('video', 'atlascloud::seedance-2.0-r2v', '3:4'), { params: Promise.resolve({ projectId: 'project-1', stageId: 'video' }) })

    expect(response.status).toBe(202)
    const first = submitterMock.submitTask.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(first.payload.aspectRatio).toBe('3:4')
  })

  it('rejects a ratio not registered by the selected Kling O3 model before submission', async () => {
    installFixtures('integration_locked')
    apiConfigMock.resolveModelSelection.mockResolvedValue({ provider: 'atlascloud', modelId: 'kling-o3-pro-r2v', modelKey: 'atlascloud::kling-o3-pro-r2v' })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.POST(request('video', 'atlascloud::kling-o3-pro-r2v', '3:4'), { params: Promise.resolve({ projectId: 'project-1', stageId: 'video' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('ASPECT_RATIO_UNSUPPORTED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('requires all approved assets and a primary before locking the next Canon status', async () => {
    prismaMock.visualDevelopmentBatch.findUnique.mockResolvedValue({
      id: 'costume-batch-1',
      stage: 'phase-04-costume',
      status: 'queued',
      characterId: 'character-1',
      promptStack: {
        stageRecord: { silhouetteSystem: 'tower', materialConstruction: 'wool', storyWear: 'soot' },
        referenceCandidateIds: ['face-1', 'hair-1'],
      },
      character: {
        id: 'character-1',
        code: 'CHR-SNO',
        status: 'hair_locked',
        characterDna: { faceBibleBatchId: 'face-lock-batch-1', hairBibleBatchId: 'hair-validation-batch-1', hairDirectionCandidateId: 'hair-1' },
        workspace: { projectId: 'project-1' },
      },
      candidates: Array.from({ length: 4 }, (_, index) => ({ id: `candidate-${index}`, taskId: `task-${index}`, shortlisted: true, isCanon: index === 0 })),
    })
    prismaMock.task.count.mockResolvedValue(4)
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.PATCH(buildMockRequest({ path: '/api/visual-development/project-1/stages/costume', method: 'PATCH', body: { action: 'canon-lock', batchId: 'costume-batch-1' } }), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })

    expect(response.status).toBe(200)
    expect(prismaMock.visualDevelopmentCharacter.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'costume_locked' }) }))
    expect(prismaMock.visualDevelopmentBatch.updateMany).toHaveBeenCalledWith({
      where: { id: 'costume-batch-1', status: 'queued' },
      data: { status: 'canon_locked' },
    })
  })

  it('two concurrent Canon locks -> only the batch that atomically claims its prior status may advance', async () => {
    prismaMock.visualDevelopmentBatch.findUnique.mockResolvedValue({
      id: 'costume-batch-race',
      stage: 'phase-04-costume',
      status: 'queued',
      characterId: 'character-1',
      promptStack: {
        stageRecord: { silhouetteSystem: 'tower', materialConstruction: 'wool', storyWear: 'soot' },
        referenceCandidateIds: ['face-1', 'hair-1'],
      },
      character: {
        id: 'character-1', code: 'CHR-SNO', status: 'hair_locked',
        characterDna: { faceBibleBatchId: 'face-lock-batch-1', hairBibleBatchId: 'hair-validation-batch-1', hairDirectionCandidateId: 'hair-1' },
        workspace: { projectId: 'project-1' },
      },
      candidates: Array.from({ length: 4 }, (_, index) => ({
        id: `race-candidate-${index}`, taskId: `race-task-${index}`, shortlisted: true, isCanon: index === 0,
      })),
    })
    prismaMock.task.count.mockResolvedValue(4)
    prismaMock.visualDevelopmentBatch.updateMany.mockResolvedValueOnce({ count: 0 })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/stages/costume',
      method: 'PATCH',
      body: { action: 'canon-lock', batchId: 'costume-batch-race' },
    }), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('STAGE_BATCH_IMMUTABLE')
    expect(prismaMock.visualDevelopmentCharacter.updateMany).not.toHaveBeenCalled()
  })

  it('does not allow asset review to mutate a Canon-locked production batch', async () => {
    prismaMock.visualDevelopmentCandidate.findUnique.mockResolvedValue({
      id: 'candidate-1', taskId: 'task-1', batchId: 'costume-batch-1',
      batch: {
        id: 'costume-batch-1', stage: 'phase-04-costume', status: 'canon_locked',
        character: { workspace: { projectId: 'project-1' } },
      },
    })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/stages/costume',
      method: 'PATCH',
      body: { action: 'asset-review', candidateId: 'candidate-1', approved: true },
    }), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('STAGE_BATCH_IMMUTABLE')
    expect(prismaMock.visualDevelopmentCandidate.update).not.toHaveBeenCalled()
  })

  it('asset review loses the batch claim race -> does not mutate a candidate after Canon lock starts', async () => {
    prismaMock.visualDevelopmentCandidate.findUnique.mockResolvedValue({
      id: 'candidate-race', taskId: 'task-race', batchId: 'costume-batch-race',
      batch: {
        id: 'costume-batch-race', stage: 'phase-04-costume', status: 'queued',
        character: { workspace: { projectId: 'project-1' } },
      },
    })
    prismaMock.visualDevelopmentBatch.updateMany.mockResolvedValueOnce({ count: 0 })
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/stages/costume',
      method: 'PATCH',
      body: { action: 'asset-review', candidateId: 'candidate-race', approved: true },
    }), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('STAGE_BATCH_IMMUTABLE')
    expect(prismaMock.task.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.visualDevelopmentCandidate.update).not.toHaveBeenCalled()
  })

  it('Canon lock re-reads the claimed batch -> rejects a review change that happened before the claim', async () => {
    const initialBatch = {
      id: 'costume-batch-recheck', stage: 'phase-04-costume', status: 'queued', characterId: 'character-1',
      character: { workspace: { projectId: 'project-1' } },
    }
    const claimedBatch = {
      ...initialBatch,
      status: 'canon_locked',
      promptStack: {
        stageRecord: { silhouetteSystem: 'tower', materialConstruction: 'wool', storyWear: 'soot' },
        referenceCandidateIds: ['face-1', 'hair-1'],
      },
      character: {
        id: 'character-1', code: 'CHR-SNO', status: 'hair_locked',
        characterDna: { faceBibleBatchId: 'face-lock-batch-1', hairBibleBatchId: 'hair-validation-batch-1', hairDirectionCandidateId: 'hair-1' },
        workspace: { projectId: 'project-1' },
      },
      candidates: Array.from({ length: 4 }, (_, index) => ({
        id: `recheck-candidate-${index}`,
        taskId: `recheck-task-${index}`,
        shortlisted: index !== 3,
        isCanon: index === 0,
      })),
    }
    prismaMock.visualDevelopmentBatch.findUnique
      .mockResolvedValueOnce(initialBatch)
      .mockResolvedValueOnce(claimedBatch)

    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/stages/costume',
      method: 'PATCH',
      body: { action: 'canon-lock', batchId: 'costume-batch-recheck' },
    }), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('STAGE_ALL_ASSETS_MUST_BE_APPROVED')
    expect(prismaMock.task.count).not.toHaveBeenCalled()
    expect(prismaMock.visualDevelopmentCharacter.updateMany).not.toHaveBeenCalled()
  })

  it('rejects an old production batch after its upstream Canon lineage changes', async () => {
    prismaMock.visualDevelopmentBatch.findUnique.mockResolvedValue({
      id: 'costume-batch-old', stage: 'phase-04-costume', status: 'queued', characterId: 'character-1',
      promptStack: {
        stageRecord: { silhouetteSystem: 'tower', materialConstruction: 'wool', storyWear: 'soot' },
        referenceCandidateIds: ['old-face', 'old-hair'],
      },
      character: {
        id: 'character-1', code: 'CHR-SNO', status: 'hair_locked',
        characterDna: { faceBibleBatchId: 'face-lock-batch-1', hairBibleBatchId: 'hair-validation-batch-1', hairDirectionCandidateId: 'hair-1' },
        workspace: { projectId: 'project-1' },
      },
      candidates: Array.from({ length: 4 }, (_, index) => ({
        id: `candidate-${index}`, taskId: `task-${index}`, shortlisted: true, isCanon: index === 0,
      })),
    })
    prismaMock.task.count.mockResolvedValue(4)
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/stages/costume', method: 'PATCH',
      body: { action: 'canon-lock', batchId: 'costume-batch-old' },
    }), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('UPSTREAM_CANON_LINEAGE_CHANGED')
    expect(prismaMock.visualDevelopmentBatch.update).not.toHaveBeenCalled()
  })
})
