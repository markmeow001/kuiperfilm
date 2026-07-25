import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockUnauthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const finalizeMock = vi.hoisted(() => vi.fn())
const storageGuardMock = vi.hoisted(() => ({
  filterAuthorizedStorageReferences: vi.fn(async (keys: string[]) => ({
    safe: keys,
    rejected: [] as string[],
  })),
}))

vi.mock('@/lib/live-composite/depth-rebuild-finalize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/live-composite/depth-rebuild-finalize')>()
  return { ...actual, finalizeDepthRebuildWorkflow: finalizeMock }
})
vi.mock('@/lib/cos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cos')>()
  return { ...actual, getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`) }
})
vi.mock('@/lib/playground/reference-guard', () => storageGuardMock)

const validBody = {
  workflowId: 'workflow_1',
  segmentRunIds: ['run-b', 'run-a'],
  sourceVideoKey: 'video/playground-ref/user-1/source.mp4',
  sourceAudioMode: 'preserve',
}

async function post(body: unknown) {
  const { POST } = await import('@/app/api/live-composite/depth-rebuild/finalize/route')
  return POST(buildMockRequest({
    path: '/api/live-composite/depth-rebuild/finalize',
    method: 'POST',
    body,
  }), { params: Promise.resolve({}) })
}

async function get(resultKey: string) {
  const { GET } = await import('@/app/api/live-composite/depth-rebuild/finalize/route')
  return GET(buildMockRequest({
    path: `/api/live-composite/depth-rebuild/finalize?resultKey=${encodeURIComponent(resultKey)}`,
    method: 'GET',
  }), { params: Promise.resolve({}) })
}

describe('POST /api/live-composite/depth-rebuild/finalize', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    storageGuardMock.filterAuthorizedStorageReferences.mockImplementation(async (keys: string[]) => ({
      safe: keys,
      rejected: [],
    }))
    finalizeMock.mockResolvedValue({
      workflowId: 'workflow_1',
      resultKey: 'video/playground-ref/user-1/depth-rebuild/workflow_1/aaaaaaaaaaaaaaaaaaaaaaaa/final.mp4',
      durationSec: 10,
      inputFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    })
  })

  it('unauthenticated request -> rejects before server-side media work', async () => {
    mockUnauthenticated()
    const response = await post(validBody)
    expect(response.status).toBe(401)
    expect(finalizeMock).not.toHaveBeenCalled()
  })

  it('completed owned result -> returns a fresh signed URL from the durable result key', async () => {
    const resultKey = 'video/playground-ref/user-1/depth-rebuild/workflow_1/aaaaaaaaaaaaaaaaaaaaaaaa/final.mp4'
    const response = await get(resultKey)

    expect(response.status).toBe(200)
    expect(storageGuardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      [resultKey],
      'user-1',
    )
    expect(await response.json()).toEqual({
      success: true,
      resultKey,
      url: `https://signed.example/${resultKey}`,
    })
  })

  it('foreign completed result -> returns not found and never signs the key', async () => {
    const resultKey = 'video/playground-ref/user-2/depth-rebuild/workflow_1/aaaaaaaaaaaaaaaaaaaaaaaa/final.mp4'
    storageGuardMock.filterAuthorizedStorageReferences.mockResolvedValue({
      safe: [],
      rejected: [resultKey],
    })

    const response = await get(resultKey)

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('DEPTH_REBUILD_RESULT_NOT_FOUND')
  })

  it('malformed result key -> rejects before the storage ownership lookup', async () => {
    const response = await get('video/playground-ref/user-1/depth-rebuild/../secret.mp4')

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('DEPTH_REBUILD_RESULT_KEY_INVALID')
    expect(storageGuardMock.filterAuthorizedStorageReferences).not.toHaveBeenCalled()
  })

  it('valid owned request -> preserves order and returns client-compatible signed result', async () => {
    const response = await post(validBody)
    expect(response.status).toBe(200)
    expect(finalizeMock).toHaveBeenCalledWith('user-1', expect.objectContaining({
      segmentRunIds: ['run-b', 'run-a'],
      sourceAudioMode: 'preserve',
    }))
    expect(await response.json()).toEqual({
      success: true,
      runId: 'workflow_1',
      url: 'https://signed.example/video/playground-ref/user-1/depth-rebuild/workflow_1/aaaaaaaaaaaaaaaaaaaaaaaa/final.mp4',
      workflowId: 'workflow_1',
      resultKey: 'video/playground-ref/user-1/depth-rebuild/workflow_1/aaaaaaaaaaaaaaaaaaaaaaaa/final.mp4',
      resultUrl: 'https://signed.example/video/playground-ref/user-1/depth-rebuild/workflow_1/aaaaaaaaaaaaaaaaaaaaaaaa/final.mp4',
      durationSec: 10,
      inputFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    })
  })

  it('arbitrary source URL -> rejects before finalize is invoked', async () => {
    const response = await post({ ...validBody, sourceVideoKey: 'https://attacker.example/source.mp4' })
    expect(response.status).toBe(400)
    expect(finalizeMock).not.toHaveBeenCalled()
    expect((await response.json()).code).toBe('DEPTH_REBUILD_FINALIZE_SOURCE_KEY_INVALID')
  })

  it('foreign run -> maps to not found without disclosing ownership', async () => {
    const { DepthRebuildFinalizeError } = await import('@/lib/live-composite/depth-rebuild-finalize')
    finalizeMock.mockRejectedValue(new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_FOUND_OR_NOT_OWNED',
      '找不到可用的片段任務',
    ))
    const response = await post(validBody)
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_FOUND_OR_NOT_OWNED')
  })

  it('incomplete run -> maps to an explicit task-not-ready response', async () => {
    const { DepthRebuildFinalizeError } = await import('@/lib/live-composite/depth-rebuild-finalize')
    finalizeMock.mockRejectedValue(new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_COMPLETED',
      '片段任務尚未完成',
    ))
    const response = await post(validBody)
    expect(response.status).toBe(202)
    expect((await response.json()).code).toBe('DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_COMPLETED')
  })
})
