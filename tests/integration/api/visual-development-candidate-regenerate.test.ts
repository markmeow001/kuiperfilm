import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const batchStore = vi.hoisted(() => ({ promptStack: { stageId: 'costume', referenceImages: ['face.png', 'hair.png'] } as unknown }))
const prismaMock = vi.hoisted(() => {
  const visualDevelopmentBatch = {
    findUnique: vi.fn(async () => ({ promptStack: batchStore.promptStack })),
    update: vi.fn(async (args: { data: { promptStack: unknown } }) => {
      batchStore.promptStack = args.data.promptStack
      return {}
    }),
  }
  const visualDevelopmentCandidate = {
    findUnique: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => ({})),
  }
  return {
    visualDevelopmentBatch,
    visualDevelopmentCandidate,
    task: { findFirst: vi.fn() },
    $transaction: vi.fn(async (operation: (transaction: {
      visualDevelopmentBatch: typeof visualDevelopmentBatch
      visualDevelopmentCandidate: typeof visualDevelopmentCandidate
    }) => Promise<void>) => operation({ visualDevelopmentBatch, visualDevelopmentCandidate })),
  }
})
const submitterMock = vi.hoisted(() => ({ submitTask: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => submitterMock)

function candidate(batchStatus = 'queued', identityLocked = false) {
  return {
    id: 'candidate-1',
    batchId: 'batch-1',
    code: 'COSTUME-FRONT',
    taskId: 'task-original',
    status: 'queued',
    requestedSeed: 123,
    effectiveSeed: 123,
    seedStatus: 'applied',
    prompt: 'original production prompt',
    negativePrompt: 'text, watermark',
    modelKey: 'atlascloud::flux-2-pro',
    provider: 'atlascloud',
    modelId: 'flux-2-pro',
    modelVersion: null,
    aspectRatio: '3:4',
    resolution: null,
    shortlisted: true,
    isCanon: identityLocked,
    rejectionNote: null,
    batch: {
      id: 'batch-1',
      status: batchStatus,
      character: {
        canonCandidateId: identityLocked ? 'candidate-1' : null,
        status: identityLocked ? 'identity_locked' : 'hair_locked',
        workspace: { projectId: 'project-1' },
      },
    },
  }
}

describe('POST /api/visual-development/[projectId]/candidates/[candidateId]/regenerate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    batchStore.promptStack = { stageId: 'costume', referenceImages: ['face.png', 'hair.png'] }
    prismaMock.visualDevelopmentCandidate.findUnique.mockResolvedValue(candidate())
    prismaMock.task.findFirst.mockResolvedValue({
      id: 'task-original',
      type: 'visual_development_image',
      targetType: 'visual-development-costume',
      status: 'completed',
      result: { resultUrls: ['images/visual-development/original.png'] },
      payload: {
        prompt: 'original production prompt',
        modelKey: 'atlascloud::flux-2-pro',
        referenceImages: ['face.png', 'hair.png'],
        aspectRatio: '3:4',
        seed: 123,
        meta: { productionStageId: 'costume' },
      },
    })
    submitterMock.submitTask.mockResolvedValue({ taskId: 'task-regenerated', status: 'queued' })
  })

  it('regenerates one slot with its recorded model inputs and preserves the previous task as history', async () => {
    const mod = await import('@/app/api/visual-development/[projectId]/candidates/[candidateId]/regenerate/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1/candidates/candidate-1/regenerate',
      method: 'POST',
      body: {
        prompt: 'edited production prompt',
        seedMode: 'reuse',
        meta: { locale: 'zh' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1', candidateId: 'candidate-1' }) })

    expect(response.status).toBe(202)
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(1)
    expect(submitterMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'candidate-1',
      payload: expect.objectContaining({
        prompt: 'edited production prompt',
        modelKey: 'atlascloud::flux-2-pro',
        referenceImages: ['face.png', 'hair.png'],
        aspectRatio: '3:4',
        seed: 123,
      }),
    }))
    expect(prismaMock.visualDevelopmentCandidate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskId: 'task-regenerated',
        prompt: 'edited production prompt',
        shortlisted: false,
        isCanon: false,
      }),
    }))
    expect(JSON.stringify(batchStore.promptStack)).toContain('task-original')
    expect(JSON.stringify(batchStore.promptStack)).toContain('original production prompt')
  })

  it('does not overwrite a Canon-locked batch', async () => {
    prismaMock.visualDevelopmentCandidate.findUnique.mockResolvedValue(candidate('canon_locked'))
    const mod = await import('@/app/api/visual-development/[projectId]/candidates/[candidateId]/regenerate/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1/candidates/candidate-1/regenerate',
      method: 'POST',
      body: { prompt: 'unsafe overwrite', seedMode: 'new', meta: { locale: 'zh' } },
    }), { params: Promise.resolve({ projectId: 'project-1', candidateId: 'candidate-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('VISUAL_DEVELOPMENT_CANON_LOCKED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('does not replace an identity that is already consumed as Casting Canon', async () => {
    prismaMock.visualDevelopmentCandidate.findUnique.mockResolvedValue(candidate('queued', true))
    const mod = await import('@/app/api/visual-development/[projectId]/candidates/[candidateId]/regenerate/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1/candidates/candidate-1/regenerate',
      method: 'POST',
      body: { prompt: 'replace locked identity', seedMode: 'new', meta: { locale: 'zh' } },
    }), { params: Promise.resolve({ projectId: 'project-1', candidateId: 'candidate-1' }) })

    expect(response.status).toBe(409)
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('allows a failed generation to be retried without losing its recorded prompt inputs', async () => {
    prismaMock.task.findFirst.mockResolvedValue({
      id: 'task-original',
      type: 'visual_development_image',
      targetType: 'visual-development-costume',
      status: 'failed',
      result: null,
      payload: {
        prompt: 'failed production prompt',
        modelKey: 'atlascloud::flux-2-pro',
        referenceImages: ['face.png', 'hair.png'],
        aspectRatio: '3:4',
        seed: 123,
        meta: { productionStageId: 'costume' },
      },
    })
    const mod = await import('@/app/api/visual-development/[projectId]/candidates/[candidateId]/regenerate/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1/candidates/candidate-1/regenerate',
      method: 'POST',
      body: { prompt: 'retry this failed slot', seedMode: 'new', meta: { locale: 'zh' } },
    }), { params: Promise.resolve({ projectId: 'project-1', candidateId: 'candidate-1' }) })

    expect(response.status).toBe(202)
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(1)
    expect(submitterMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        prompt: 'retry this failed slot',
        modelKey: 'atlascloud::flux-2-pro',
        referenceImages: ['face.png', 'hair.png'],
        aspectRatio: '3:4',
      }),
    }))
  })
})
