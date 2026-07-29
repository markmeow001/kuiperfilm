import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentCharacter: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
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
    findUnique: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(async (operations: unknown[]) => operations),
}))

const apiConfigMock = vi.hoisted(() => ({ resolveModelSelection: vi.fn() }))
const submitterMock = vi.hoisted(() => ({ submitTask: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)

function request(stageId: 'costume' | 'video', modelKey: string) {
  const records = stageId === 'costume'
    ? { silhouetteSystem: 'tower-like layered silhouette', materialConstruction: 'worn wool, leather and aged silver', storyWear: 'motivated repairs and soot at contact zones' }
    : { performanceActions: 'walk, listen, speak and controlled action', motionRules: 'natural weight, restrained face and stable cloth', continuityChecks: 'identity, costume, props, scene and light remain stable' }
  return buildMockRequest({
    path: `/api/visual-development/project-1/stages/${stageId}`,
    method: 'POST',
    body: {
      characterCode: 'CHR-SNO',
      modelKey,
      aspectRatio: stageId === 'video' ? '16:9' : '3:4',
      duration: 5,
      stageRecord: records,
      meta: { locale: 'zh' },
    },
  })
}

function installFixtures(status = 'hair_locked') {
  prismaMock.visualDevelopmentCharacter.findFirst.mockResolvedValue({
    id: 'character-1',
    code: 'CHR-SNO',
    status,
    characterDna: { role: 'protagonist', coreTraits: 'guarded and determined' },
    castingBrief: { apparentAge: '24–28' },
    workspace: { id: 'workspace-1', projectId: 'project-1', worldBible: { projectPremise: 'underground city', visualThesis: 'sacred order hides predation' } },
  })
  prismaMock.visualDevelopmentCandidate.findFirst.mockImplementation(async (args: { where: { batch: { stage: string } } }) => {
    const stage = args.where.batch.stage
    if (stage === 'face-lock') return { id: 'face-1', taskId: 'face-task-1', code: 'EXPR-RESTRAINED' }
    if (stage === 'hair-exploration') return { id: 'hair-1', taskId: 'hair-task-1', code: 'HAIR-LONG-CENTER', isCanon: true }
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
    expect(first.payload.prompt).toContain('Reference image 1 is the locked Face ID')
    expect(first.payload.prompt).toContain('Reference image 2 is the approved upstream design asset')
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
    expect(first.payload.prompt).toContain('same performer')
  })

  it('requires all approved assets and a primary before locking the next Canon status', async () => {
    prismaMock.visualDevelopmentBatch.findUnique.mockResolvedValue({
      id: 'costume-batch-1',
      stage: 'phase-04-costume',
      characterId: 'character-1',
      promptStack: { stageRecord: { silhouetteSystem: 'tower', materialConstruction: 'wool', storyWear: 'soot' } },
      character: { id: 'character-1', code: 'CHR-SNO', characterDna: {}, workspace: { projectId: 'project-1' } },
      candidates: Array.from({ length: 4 }, (_, index) => ({ id: `candidate-${index}`, taskId: `task-${index}`, shortlisted: true, isCanon: index === 0 })),
    })
    prismaMock.task.count.mockResolvedValue(4)
    const mod = await import('@/app/api/visual-development/[projectId]/stages/[stageId]/route')
    const response = await mod.PATCH(buildMockRequest({ path: '/api/visual-development/project-1/stages/costume', method: 'PATCH', body: { action: 'canon-lock', batchId: 'costume-batch-1' } }), { params: Promise.resolve({ projectId: 'project-1', stageId: 'costume' }) })

    expect(response.status).toBe(200)
    expect(prismaMock.visualDevelopmentCharacter.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'costume_locked' }) }))
    expect(prismaMock.visualDevelopmentBatch.update).toHaveBeenCalledWith({ where: { id: 'costume-batch-1' }, data: { status: 'canon_locked' } })
  })
})
