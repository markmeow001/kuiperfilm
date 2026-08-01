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
    findFirst: vi.fn(),
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

const hairRecord = {
  hairSilhouette: 'readable around the face and compatible with a high collar',
  partingAndHairline: 'preserve the natural Canon hairline',
  lengthAndTexture: 'believable strand grouping, density and weight',
  storyRequirements: 'formal and distressed states share the same core cut',
  forbiddenDrift: 'face, age, ancestry, body, wardrobe and background',
}

function request(action: 'explore' | 'validate', modelKey: string) {
  return buildMockRequest({
    path: '/api/visual-development/project-1/hair-design',
    method: 'POST',
    body: {
      action,
      characterCode: 'CHR-SNO',
      modelKey,
      aspectRatio: '3:4',
      hairRecord,
      ...(action === 'validate' ? { explorationCandidateId: 'hair-choice-1' } : {}),
      meta: { locale: 'zh' },
    },
  })
}

function installFixtures() {
  prismaMock.visualDevelopmentCharacter.findFirst.mockResolvedValue({
    id: 'character-1',
    code: 'CHR-SNO',
    status: 'face_locked',
    characterDna: { faceCanonId: 'FACE-CHR-SNO-v001' },
    castingBrief: { apparentAge: '24–28' },
    workspace: { id: 'workspace-1', projectId: 'project-1', worldBible: { premise: 'underground city' } },
  })
  prismaMock.visualDevelopmentBatch.findFirst.mockResolvedValue({
    id: 'face-batch-1',
    candidates: [{ id: 'face-identity-1', code: 'EXPR-RESTRAINED', taskId: 'face-task-1' }],
  })
  prismaMock.visualDevelopmentCandidate.findFirst.mockResolvedValue({
    id: 'hair-choice-1',
    taskId: 'hair-task-1',
    isCanon: true,
    batch: { id: 'hair-exploration-1', characterId: 'character-1', stage: 'hair-exploration' },
  })
  prismaMock.task.findFirst.mockImplementation(async (args: { where: { id: string } }) => ({
    id: args.where.id,
    result: {
      resultUrls: [args.where.id === 'face-task-1'
        ? 'images/visual-development/face.png'
        : 'images/visual-development/hair.png'],
    },
  }))
  prismaMock.visualDevelopmentBatch.create.mockImplementation(async (args: {
    data: { stage: string; candidates: { create: Array<Record<string, unknown>> } }
  }) => ({
    id: `${args.data.stage}-batch-1`,
    candidateCount: args.data.candidates.create.length,
    candidates: args.data.candidates.create.map((candidate, index) => ({
      ...candidate,
      id: `${args.data.stage}-candidate-${index + 1}`,
    })),
  }))
  submitterMock.submitTask.mockImplementation(async (input: { targetId: string }) => ({
    taskId: `task-${input.targetId}`,
    status: 'queued',
  }))
}

describe('POST /api/visual-development/[projectId]/hair-design', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    installFixtures()
  })

  it('rejects a single-reference model before creating a hair batch', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud',
      modelId: 'flux-kontext-pro',
      modelKey: 'atlascloud::flux-kontext-pro',
    })
    const mod = await import('@/app/api/visual-development/[projectId]/hair-design/route')
    const response = await mod.POST(request('explore', 'atlascloud::flux-kontext-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('HAIR_MULTI_REFERENCE_MODEL_REQUIRED')
    expect(prismaMock.visualDevelopmentBatch.create).not.toHaveBeenCalled()
  })

  it('fans out ten one-reference exploration tasks', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud',
      modelId: 'flux-2-pro',
      modelKey: 'atlascloud::flux-2-pro',
    })
    const mod = await import('@/app/api/visual-development/[projectId]/hair-design/route')
    const response = await mod.POST(request('explore', 'atlascloud::flux-2-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.data.submitted).toBe(10)
    expect(body.data.referenceImageCount).toBe(1)
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(10)
    const first = submitterMock.submitTask.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(first.payload.referenceImages).toEqual(['images/visual-development/face.png'])
    expect(first.payload.prompt).toContain('Change only hairstyle construction')
  })

  it('fans out eight validation tasks with separate identity and hair references', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud',
      modelId: 'seedream-v5.0-lite',
      modelKey: 'atlascloud::seedream-v5.0-lite',
    })
    const mod = await import('@/app/api/visual-development/[projectId]/hair-design/route')
    const response = await mod.POST(request('validate', 'atlascloud::seedream-v5.0-lite'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.data.submitted).toBe(8)
    expect(body.data.referenceImageCount).toBe(2)
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(8)
    const first = submitterMock.submitTask.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(first.payload.referenceImages).toEqual([
      'images/visual-development/face.png',
      'images/visual-development/hair.png',
    ])
    expect(first.payload.prompt).toContain('Reference image 1 is the exclusive identity authority')
    expect(first.payload.prompt).toContain('Reference image 2 is the exclusive hairstyle-construction authority')
  })

  it('rejects Hair Canon lock when the selected exploration asset changed after validation', async () => {
    prismaMock.visualDevelopmentBatch.findUnique.mockResolvedValue({
      id: 'hair-validation-batch-1', stage: 'hair-validation', status: 'queued', characterId: 'character-1',
      promptStack: { sourceHairCandidateId: 'hair-choice-1' },
      character: {
        id: 'character-1', code: 'CHR-SNO', characterDna: {}, status: 'hair_validation_in_progress',
        workspace: { projectId: 'project-1' },
      },
      candidates: Array.from({ length: 8 }, (_, index) => ({
        id: `validation-${index}`, taskId: `task-${index}`, shortlisted: true,
      })),
    })
    prismaMock.task.count.mockResolvedValue(8)
    prismaMock.visualDevelopmentCandidate.findFirst.mockResolvedValue(null)
    const mod = await import('@/app/api/visual-development/[projectId]/hair-design/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/hair-design', method: 'PATCH',
      body: { action: 'hair-lock', batchId: 'hair-validation-batch-1' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('HAIR_CANON_LINEAGE_CHANGED')
    expect(prismaMock.visualDevelopmentBatch.update).not.toHaveBeenCalled()
  })
})
