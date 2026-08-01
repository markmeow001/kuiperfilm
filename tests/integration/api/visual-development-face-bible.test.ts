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
    updateMany: vi.fn(async () => ({ count: 1 })),
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
  $transaction: vi.fn(),
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

function postRequest(
  modelKey = 'atlascloud::flux-kontext-pro',
  faceLockRecord: Record<string, string> = {
    identityAnchors: 'long face, wide-set eyes, subtly crooked nose',
    allowedVariation: 'camera angle and requested micro-expression only',
    forbiddenDrift: 'age, ancestry, eye spacing, nose, lips, jaw and hairline',
  },
) {
  return buildMockRequest({
    path: '/api/visual-development/project-1/face-bible',
    method: 'POST',
    body: {
      characterCode: 'CHR-SNO',
      modelKey,
      aspectRatio: '3:4',
      faceLockRecord,
      meta: { locale: 'zh' },
    },
  })
}

function installCanonFixture() {
  prismaMock.visualDevelopmentCharacter.findFirst.mockResolvedValue({
    id: 'character-1',
    code: 'CHR-SNO',
    canonCandidateId: 'canon-candidate-1',
    status: 'identity_locked',
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
    prismaMock.visualDevelopmentCharacter.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
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

  it('uses the Canon image when optional text identity notes are blank', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud',
      modelId: 'flux-2-pro',
      modelKey: 'atlascloud::flux-2-pro',
    })
    prismaMock.visualDevelopmentBatch.create.mockImplementation(async (args: {
      data: {
        candidates: { create: Array<Record<string, unknown>> }
      }
    }) => ({
      id: 'face-batch-canon-only',
      candidateCount: args.data.candidates.create.length,
      candidates: args.data.candidates.create.map((candidate, index) => ({
        ...candidate,
        id: `face-canon-only-${index + 1}`,
      })),
    }))
    submitterMock.submitTask.mockImplementation(async (input: { targetId: string }) => ({
      taskId: `task-${input.targetId}`,
      status: 'queued',
    }))

    const mod = await import('@/app/api/visual-development/[projectId]/face-bible/route')
    const response = await mod.POST(postRequest('atlascloud::flux-2-pro', {
      identityAnchors: '',
      allowedVariation: '',
      forbiddenDrift: '',
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(202)
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(10)
    expect(prismaMock.visualDevelopmentBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promptStack: expect.objectContaining({
            identityAnchors: 'Use all observable identity anchors from Canon reference',
          }),
        }),
      }),
    )
  })

  it('Face Canon 已鎖定 -> 不得再建立付費 Face Bible 批次', async () => {
    prismaMock.visualDevelopmentCharacter.findFirst.mockResolvedValue({
      id: 'character-1', code: 'CHR-SNO', canonCandidateId: 'canon-candidate-1', status: 'face_locked',
      characterDna: { role: 'runaway witness', faceBibleBatchId: 'face-batch-locked' },
      castingBrief: { apparentAge: '24–28' },
      workspace: { id: 'workspace-1', projectId: 'project-1', worldBible: { premise: 'underground city' } },
    })
    const mod = await import('@/app/api/visual-development/[projectId]/face-bible/route')
    const response = await mod.POST(postRequest(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('FACE_CANON_ALREADY_LOCKED')
    expect(apiConfigMock.resolveModelSelection).not.toHaveBeenCalled()
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/visual-development/[projectId]/face-bible Canon guard', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    prismaMock.visualDevelopmentCharacter.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
  })

  it('Face Canon 已鎖定 -> 舊分頁不得更改資產審核', async () => {
    prismaMock.visualDevelopmentCandidate.findUnique.mockResolvedValue({
      id: 'face-candidate-1', taskId: 'task-face-1',
      batch: {
        id: 'face-batch-1', stage: 'face-lock', status: 'canon_locked',
        character: {
          id: 'character-1', status: 'face_locked', characterDna: { faceBibleBatchId: 'face-batch-1' },
          workspace: { projectId: 'project-1' },
        },
      },
    })
    const mod = await import('@/app/api/visual-development/[projectId]/face-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/face-bible', method: 'PATCH',
      body: { action: 'asset-review', candidateId: 'face-candidate-1', approved: true },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('FACE_CANON_ALREADY_LOCKED')
    expect(prismaMock.visualDevelopmentCandidate.update).not.toHaveBeenCalled()
  })

  it('資產審核在交易內暫時鎖住角色，避免與 Canon Lock 交錯覆蓋', async () => {
    prismaMock.visualDevelopmentCandidate.findUnique.mockResolvedValue({
      id: 'face-candidate-1', taskId: 'task-face-1',
      batch: {
        id: 'face-batch-1', stage: 'face-lock', status: 'queued',
        character: {
          id: 'character-1', status: 'face_lock_in_progress', characterDna: {},
          workspace: { projectId: 'project-1' },
        },
      },
    })
    prismaMock.task.findFirst.mockResolvedValue({ id: 'task-face-1' })
    prismaMock.visualDevelopmentCandidate.update.mockResolvedValue({ id: 'face-candidate-1', shortlisted: true })

    const mod = await import('@/app/api/visual-development/[projectId]/face-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/face-bible', method: 'PATCH',
      body: { action: 'asset-review', candidateId: 'face-candidate-1', approved: true },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    expect(prismaMock.visualDevelopmentCharacter.updateMany).toHaveBeenCalledWith({
      where: { id: 'character-1', status: 'face_lock_in_progress' },
      data: { status: 'face_lock_reviewing' },
    })
    expect(prismaMock.visualDevelopmentCharacter.update).toHaveBeenCalledWith({
      where: { id: 'character-1' }, data: { status: 'face_lock_in_progress' },
    })
  })

  it('Canon Lock 交易內重新讀取審核結果，拒絕剛被退回的資產', async () => {
    const approvedCandidates = Array.from({ length: 10 }, (_, index) => ({
      id: `face-${index + 1}`, taskId: `task-${index + 1}`, shortlisted: true,
    }))
    const outerBatch = {
      id: 'face-batch-1', stage: 'face-lock', status: 'queued', characterId: 'character-1',
      character: {
        id: 'character-1', code: 'CHR-SNO', status: 'face_lock_in_progress', characterDna: {},
        workspace: { projectId: 'project-1' },
      },
      candidates: approvedCandidates,
    }
    prismaMock.visualDevelopmentBatch.findUnique
      .mockResolvedValueOnce(outerBatch)
      .mockResolvedValueOnce({
        ...outerBatch,
        candidates: approvedCandidates.map((candidate, index) => index === 0
          ? { ...candidate, shortlisted: false }
          : candidate),
      })
    prismaMock.task.count.mockResolvedValue(10)

    const mod = await import('@/app/api/visual-development/[projectId]/face-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/face-bible', method: 'PATCH',
      body: { action: 'face-bible-lock', batchId: 'face-batch-1' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('FACE_BIBLE_ALL_ASSETS_MUST_BE_APPROVED')
    expect(prismaMock.visualDevelopmentCharacter.update).not.toHaveBeenCalled()
    expect(prismaMock.visualDevelopmentBatch.update).not.toHaveBeenCalled()
  })

  it('第二個 Face 批次不得取代已鎖定 Canon', async () => {
    prismaMock.visualDevelopmentBatch.findUnique.mockResolvedValue({
      id: 'face-batch-old', stage: 'face-lock', status: 'queued', characterId: 'character-1',
      character: {
        id: 'character-1', code: 'CHR-SNO', status: 'face_locked',
        characterDna: { faceBibleBatchId: 'face-batch-canon' },
        workspace: { projectId: 'project-1' },
      },
      candidates: [],
    })
    const mod = await import('@/app/api/visual-development/[projectId]/face-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/face-bible', method: 'PATCH',
      body: { action: 'face-bible-lock', batchId: 'face-batch-old' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('FACE_CANON_ALREADY_LOCKED')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
