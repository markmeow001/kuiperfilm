import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentCharacter: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  visualDevelopmentCandidate: {
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

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelection: vi.fn(),
}))

const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)

function postRequest(modelKey = 'atlascloud::flux-kontext-pro') {
  return buildMockRequest({
    path: '/api/visual-development/project-1/face-bible',
    method: 'POST',
    body: {
      characterCode: 'CHR-SNO',
      modelKey,
      aspectRatio: '3:4',
      faceLockRecord: {
        identityAnchors: 'long face, wide-set eyes, subtly crooked nose',
        allowedVariation: 'camera angle and requested micro-expression only',
        forbiddenDrift: 'age, ancestry, eye spacing, nose, lips, jaw and hairline',
      },
      meta: { locale: 'zh' },
    },
  })
}

function installCanonFixture() {
  prismaMock.visualDevelopmentCharacter.findFirst.mockResolvedValue({
    id: 'character-1',
    code: 'CHR-SNO',
    canonCandidateId: 'canon-candidate-1',
    characterDna: { role: 'runaway witness' },
    castingBrief: { apparentAge: '24–28' },
    workspace: { id: 'workspace-1', projectId: 'project-1', worldBible: { premise: 'underground city' } },
  })
  prismaMock.visualDevelopmentCandidate.findUnique.mockResolvedValue({
    id: 'canon-candidate-1',
    taskId: 'canon-task-1',
    batch: { id: 'casting-batch-1', characterId: 'character-1', stage: 'casting' },
  })
  prismaMock.task.findFirst.mockResolvedValue({
    id: 'canon-task-1',
    result: { resultUrls: ['images/visual-development/canon.png'] },
  })
}

describe('POST /api/visual-development/[projectId]/face-bible', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    installCanonFixture()
  })

  it('rejects a model without declared reference-image support before task submission', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'google',
      modelId: 'imagen-4.0-generate-001',
      modelKey: 'google::imagen-4.0-generate-001',
    })
    const mod = await import('@/app/api/visual-development/[projectId]/face-bible/route')
    const response = await mod.POST(postRequest('google::imagen-4.0-generate-001'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('FACE_LOCK_REFERENCE_MODEL_REQUIRED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('fans out ten controlled identity-reference tasks from the locked Canon asset', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud',
      modelId: 'flux-kontext-pro',
      modelKey: 'atlascloud::flux-kontext-pro',
    })
    prismaMock.visualDevelopmentBatch.create.mockImplementation(async (args: {
      data: {
        candidates: { create: Array<Record<string, unknown>> }
      }
    }) => ({
      id: 'face-batch-1',
      candidateCount: args.data.candidates.create.length,
      candidates: args.data.candidates.create.map((candidate, index) => ({
        ...candidate,
        id: `face-candidate-${index + 1}`,
      })),
    }))
    submitterMock.submitTask.mockImplementation(async (input: { targetId: string }) => ({
      taskId: `task-${input.targetId}`,
      status: 'queued',
    }))

    const mod = await import('@/app/api/visual-development/[projectId]/face-bible/route')
    const response = await mod.POST(postRequest(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.data.submitted).toBe(10)
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(10)
    const firstSubmission = submitterMock.submitTask.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>
    }
    expect(firstSubmission.payload.referenceImages).toEqual(['images/visual-development/canon.png'])
    expect(firstSubmission.payload.modelKey).toBe('atlascloud::flux-kontext-pro')
    expect(firstSubmission.payload.prompt).toContain('reference image 1 exclusively as the identity source')
    expect(prismaMock.visualDevelopmentBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stage: 'face-lock',
          candidateCount: 10,
          modelKey: 'atlascloud::flux-kontext-pro',
        }),
      }),
    )
  })
})
