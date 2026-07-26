import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  workspaceMember: { findFirst: vi.fn(async () => null) },
  workspace: { findFirst: vi.fn(async () => null) },
  task: {
    findFirst: vi.fn<() => Promise<{
      id: string
      status: string
      createdAt: Date
      finishedAt: Date | null
    } | null>>(async () => null),
  },
}))

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelection: vi.fn(async (_userId: string, modelKey: string, mediaType: string) => ({
    provider: modelKey.split('::')[0] || 'atlascloud',
    modelId: modelKey.split('::')[1] || modelKey,
    modelKey,
    mediaType,
  })),
}))

const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn<(arg: Record<string, unknown>) => Promise<{
    success: boolean
    async: boolean
    taskId: string
    runId: string
    status: string
    deduped: boolean
  }>>(async () => ({
    success: true,
    async: true,
    taskId: 'task-1',
    runId: 'run-1',
    status: 'queued',
    deduped: false,
  })),
}))

const guardMock = vi.hoisted(() => ({
  filterAuthorizedReferences: vi.fn(async (refs: string[]) => ({
    safe: refs,
    rejected: [] as string[],
  })),
  filterAuthorizedStorageReferences: vi.fn(async (refs: string[]) => ({
    safe: refs,
    rejected: [] as string[],
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)
vi.mock('@/lib/playground/reference-guard', () => guardMock)

describe('POST /api/playground/run — Seedance reference-video normalization contract', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    guardMock.filterAuthorizedReferences.mockImplementation(async (refs: string[]) => ({
      safe: refs,
      rejected: [],
    }))
    guardMock.filterAuthorizedStorageReferences.mockImplementation(async (refs: string[]) => ({
      safe: refs,
      rejected: [],
    }))
    prismaMock.task.findFirst.mockResolvedValue(null)
  })

  async function loadRoute() {
    return await import('@/app/api/playground/run/route')
  }

  function body(overrides: Record<string, unknown> = {}) {
    return {
      prompt: 'follow video 1 depth motion',
      outputType: 'video',
      modelKey: 'atlascloud::seedance-2.0-r2v',
      referenceVideos: ['video/playground-ref/user-1/depth.webm'],
      normalizeSeedanceReferenceVideo: true,
      durationSec: 12,
      ...overrides,
    }
  }

  function dualGuideBody(overrides: Record<string, unknown> = {}) {
    return body({
      prompt: 'video 1 is RGB motion authority; video 2 is depth geometry authority',
      referenceVideos: [
        'video/playground-ref/user-1/source-rgb.mp4',
        'video/playground-ref/user-1/source-depth.webm',
      ],
      sourceAudioMode: 'reference-only',
      depthRebuildDualGuide: true,
      workflowId: 'workflow_1',
      segmentIndex: 0,
      segmentCount: 2,
      referenceVideoWindow: { startSeconds: 0, durationSeconds: 5.5 },
      durationSec: 5.5,
      resolution: '720p',
      aspectRatio: '16:9',
      ...overrides,
    })
  }

  function adaptiveGuideBody(overrides: Record<string, unknown> = {}) {
    return body({
      prompt: 'video 1 is the complete depth guide; video 2 is the critical RGB guide',
      referenceVideos: [
        'video/playground-ref/user-1/source-depth.webm',
        'video/playground-ref/user-1/source-rgb.mp4',
      ],
      sourceAudioMode: 'reference-only',
      workflowId: 'workflow_v2',
      depthRebuildGuideContract: {
        version: 2,
        strategy: 'full-depth-critical-rgb',
        sourceVideoKey: 'video/playground-ref/user-1/source-rgb.mp4',
        sourceDurationSeconds: 11.2,
        outputDurationSeconds: 12,
        referenceVideoWindows: [
          { role: 'depth', startSeconds: 0, durationSeconds: 11.2 },
          { role: 'rgb', startSeconds: 4.6, durationSeconds: 3.3 },
        ],
      },
      durationSec: 12,
      resolution: '720p',
      aspectRatio: '16:9',
      ...overrides,
    })
  }

  it('v2 完整 Depth＋關鍵 RGB -> 固定 Depth-first、獨立 trim 並保存 immutable meta', async () => {
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: adaptiveGuideBody(),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(guardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      [
        'video/playground-ref/user-1/source-depth.webm',
        'video/playground-ref/user-1/source-rgb.mp4',
      ],
      'user-1',
    )
    expect(guardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      ['video/playground-ref/user-1/source-rgb.mp4'],
      'user-1',
    )
    const payload = submitterMock.submitTask.mock.calls.at(-1)?.[0]?.payload as
      | Record<string, unknown>
      | undefined
    const contract = {
      version: 2,
      strategy: 'full-depth-critical-rgb',
      sourceVideoKey: 'video/playground-ref/user-1/source-rgb.mp4',
      sourceDurationSeconds: 11.2,
      outputDurationSeconds: 12,
      referenceVideoWindows: [
        { role: 'depth', startSeconds: 0, durationSeconds: 11.2 },
        { role: 'rgb', startSeconds: 4.6, durationSeconds: 3.3 },
      ],
    }
    expect(payload).toMatchObject({
      referenceVideos: [
        'video/playground-ref/user-1/source-depth.webm',
        'video/playground-ref/user-1/source-rgb.mp4',
      ],
      sourceVideoKey: 'video/playground-ref/user-1/source-rgb.mp4',
      depthRebuildGuideContract: contract,
      normalizeSeedanceReferenceVideo: true,
      sourceAudioMode: 'reference-only',
      duration: 12,
      meta: {
        depthRebuildContract: {
          ...contract,
          workflowId: 'workflow_v2',
          segmentIndex: 0,
          segmentCount: 1,
          referenceVideos: [
            'video/playground-ref/user-1/source-depth.webm',
            'video/playground-ref/user-1/source-rgb.mp4',
          ],
          normalizeSeedanceReferenceVideo: true,
          duration: 12,
          modelKey: 'atlascloud::seedance-2.0-r2v',
          resolution: '720p',
          aspectRatio: '16:9',
          sourceAudioMode: 'reference-only',
        },
      },
    })
    expect(payload).not.toHaveProperty('depthRebuildDualGuide')
    expect(payload).not.toHaveProperty('referenceVideoWindow')
  })

  it('v2 15 秒 Depth-only -> 單一完整 Depth 可使用 15 秒硬上限', async () => {
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: adaptiveGuideBody({
        referenceVideos: ['video/playground-ref/user-1/source-depth.webm'],
        sourceAudioMode: 'generate',
        depthRebuildGuideContract: {
          version: 2,
          strategy: 'full-depth-only',
          sourceVideoKey: 'video/playground-ref/user-1/source-rgb.mp4',
          sourceDurationSeconds: 15,
          outputDurationSeconds: 15,
          referenceVideoWindows: [
            { role: 'depth', startSeconds: 0, durationSeconds: 15 },
          ],
        },
        durationSec: 15,
      }),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const payload = submitterMock.submitTask.mock.calls.at(-1)?.[0]?.payload as
      | Record<string, unknown>
      | undefined
    expect(payload?.referenceVideos).toEqual([
      'video/playground-ref/user-1/source-depth.webm',
    ])
    expect(payload?.duration).toBe(15)
  })

  it('v2 7.2 秒完整 Depth＋完整 RGB -> 合計 14.4 秒可建立任務', async () => {
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: adaptiveGuideBody({
        depthRebuildGuideContract: {
          version: 2,
          strategy: 'full-depth-full-rgb',
          sourceVideoKey: 'video/playground-ref/user-1/source-rgb.mp4',
          sourceDurationSeconds: 7.2,
          outputDurationSeconds: 8,
          referenceVideoWindows: [
            { role: 'depth', startSeconds: 0, durationSeconds: 7.2 },
            { role: 'rgb', startSeconds: 0, durationSeconds: 7.2 },
          ],
        },
        durationSec: 8,
      }),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(submitterMock.submitTask.mock.calls.at(-1)?.[0]?.payload)
      .toMatchObject({ duration: 8 })
  })

  it.each([
    {
      label: '雙參考合計超過 14.5 秒',
      overrides: {
        depthRebuildGuideContract: {
          version: 2,
          strategy: 'full-depth-full-rgb',
          sourceVideoKey: 'video/playground-ref/user-1/source-rgb.mp4',
          sourceDurationSeconds: 7.3,
          outputDurationSeconds: 8,
          referenceVideoWindows: [
            { role: 'depth', startSeconds: 0, durationSeconds: 7.3 },
            { role: 'rgb', startSeconds: 0, durationSeconds: 7.3 },
          ],
        },
        durationSec: 8,
      },
      code: 'DEPTH_REBUILD_GUIDE_REFERENCE_TOTAL_OVER_SAFE_LIMIT',
    },
    {
      label: 'RGB trim 少於 2 秒',
      overrides: {
        depthRebuildGuideContract: {
          version: 2,
          strategy: 'full-depth-critical-rgb',
          sourceVideoKey: 'video/playground-ref/user-1/source-rgb.mp4',
          sourceDurationSeconds: 11.2,
          outputDurationSeconds: 12,
          referenceVideoWindows: [
            { role: 'depth', startSeconds: 0, durationSeconds: 11.2 },
            { role: 'rgb', startSeconds: 5, durationSeconds: 1.99 },
          ],
        },
      },
      code: 'DEPTH_REBUILD_GUIDE_REFERENCE_DURATION_INVALID',
    },
    {
      label: '輸出不是來源秒數向上取整',
      overrides: {
        depthRebuildGuideContract: {
          version: 2,
          strategy: 'full-depth-critical-rgb',
          sourceVideoKey: 'video/playground-ref/user-1/source-rgb.mp4',
          sourceDurationSeconds: 11.2,
          outputDurationSeconds: 11,
          referenceVideoWindows: [
            { role: 'depth', startSeconds: 0, durationSeconds: 11.2 },
            { role: 'rgb', startSeconds: 4.6, durationSeconds: 3.3 },
          ],
        },
        durationSec: 11,
      },
      code: 'DEPTH_REBUILD_GUIDE_OUTPUT_DURATION_MISMATCH',
    },
    {
      label: '混入 v1 同步窗',
      overrides: { referenceVideoWindow: { startSeconds: 0, durationSeconds: 5 } },
      code: 'DEPTH_REBUILD_GUIDE_LEGACY_WINDOW_CONFLICT',
    },
    {
      label: '混入 v1 雙引導旗標',
      overrides: { depthRebuildDualGuide: true },
      code: 'DEPTH_REBUILD_GUIDE_CONTRACT_CONFLICT',
    },
    {
      label: '缺少 v2 workflowId',
      overrides: { workflowId: undefined },
      code: 'DEPTH_REBUILD_GUIDE_WORKFLOW_ID_INVALID',
    },
    {
      label: '混入 v1 分段序號',
      overrides: { segmentIndex: 0, segmentCount: 1 },
      code: 'DEPTH_REBUILD_GUIDE_WORKFLOW_ID_INVALID',
    },
    {
      label: '直接送 preserve 而未交由完稿恢復原音',
      overrides: { sourceAudioMode: 'preserve' },
      code: 'DEPTH_REBUILD_GUIDE_OUTPUT_CONTRACT_INVALID',
    },
  ])('v2 $label -> 400 且付費任務不建立', async ({ overrides, code }) => {
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: adaptiveGuideBody(overrides),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect((await response.json()).error.details.code).toBe(code)
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('v2 referenceVideos 不是 Depth-first / RGB-source-second -> 400', async () => {
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: adaptiveGuideBody({
        referenceVideos: [
          'video/playground-ref/user-1/source-rgb.mp4',
          'video/playground-ref/user-1/source-depth.webm',
        ],
      }),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect((await response.json()).error.details.code)
      .toBe('DEPTH_REBUILD_GUIDE_DEPTH_REFERENCE_INVALID')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('v2 sourceVideoKey 未通過本人 storage ownership -> 403', async () => {
    guardMock.filterAuthorizedStorageReferences.mockImplementation(async (refs: string[]) => (
      refs.length === 1 && refs[0] === 'video/playground-ref/user-1/source-rgb.mp4'
        ? { safe: [], rejected: refs }
        : { safe: refs, rejected: [] }
    ))
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: adaptiveGuideBody(),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    expect((await response.json()).error.details.code)
      .toBe('DEPTH_REBUILD_GUIDE_SOURCE_VIDEO_NOT_TRUSTED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it.each([
    'atlascloud::seedance-2.0-r2v',
    'atlascloud::seedance-2.0-fast-r2v',
  ])('白名單模型 %s + 唯一參考影片 -> payload 顯式帶入正規化旗標', async (modelKey) => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({ modelKey }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const submission = submitterMock.submitTask.mock.calls.at(-1)?.[0] as {
      type?: string
      payload?: Record<string, unknown>
    } | undefined
    expect(submission?.type).toBe('playground_video')
    expect(submission?.payload).toMatchObject({
      modelKey,
      outputType: 'video',
      referenceVideos: ['video/playground-ref/user-1/depth.webm'],
      normalizeSeedanceReferenceVideo: true,
    })
    expect(guardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      ['video/playground-ref/user-1/depth.webm'],
      'user-1',
    )
  })

  it.each([
    'atlascloud::seedance-2.0-r2v',
    'atlascloud::seedance-2.0-fast-r2v',
  ])('RGB＋Depth + 白名單模型 %s -> 保留參考順序、同步窗與雙引導契約', async (modelKey) => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({ modelKey }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(guardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      [
        'video/playground-ref/user-1/source-rgb.mp4',
        'video/playground-ref/user-1/source-depth.webm',
      ],
      'user-1',
    )
    const payload = submitterMock.submitTask.mock.calls.at(-1)?.[0]?.payload as
      | Record<string, unknown>
      | undefined
    expect(payload).toMatchObject({
      modelKey,
      referenceVideos: [
        'video/playground-ref/user-1/source-rgb.mp4',
        'video/playground-ref/user-1/source-depth.webm',
      ],
      normalizeSeedanceReferenceVideo: true,
      depthRebuildDualGuide: true,
      workflowId: 'workflow_1',
      segmentIndex: 0,
      segmentCount: 2,
      sourceAudioMode: 'reference-only',
      referenceVideoWindow: { startSeconds: 0, durationSeconds: 5.5 },
      duration: 5.5,
      meta: {
        depthRebuildContract: {
          version: 1,
          workflowId: 'workflow_1',
          segmentIndex: 0,
          segmentCount: 2,
          depthRebuildDualGuide: true,
          normalizeSeedanceReferenceVideo: true,
          referenceVideos: [
            'video/playground-ref/user-1/source-rgb.mp4',
            'video/playground-ref/user-1/source-depth.webm',
          ],
          referenceVideoWindow: { startSeconds: 0, durationSeconds: 5.5 },
          duration: 5.5,
          modelKey,
          resolution: '720p',
          aspectRatio: '16:9',
          sourceAudioMode: 'reference-only',
        },
      },
    })
  })

  it('RGB＋Depth 的任一 storage 參考未授權 -> 403，兩支都不得進 worker', async () => {
    guardMock.filterAuthorizedStorageReferences.mockResolvedValue({
      safe: ['video/playground-ref/user-1/source-rgb.mp4'],
      rejected: ['video/playground-ref/other-user/source-depth.webm'],
    })
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({
        referenceVideos: [
          'video/playground-ref/user-1/source-rgb.mp4',
          'video/playground-ref/other-user/source-depth.webm',
        ],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.error.details.code)
      .toBe('SEEDANCE_REFERENCE_NORMALIZATION_REFERENCE_NOT_TRUSTED')
    expect(guardMock.filterAuthorizedStorageReferences).toHaveBeenCalledWith(
      [
        'video/playground-ref/user-1/source-rgb.mp4',
        'video/playground-ref/other-user/source-depth.webm',
      ],
      'user-1',
    )
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('RGB＋Depth + 非 Atlas Seedance 模型 -> 400，不建立付費任務', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({
        modelKey: 'fal::bytedance/seedance-2.0/reference-to-video',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('SEEDANCE_REFERENCE_NORMALIZATION_MODEL_UNSUPPORTED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('RGB＋Depth 缺同步窗 -> 400，不把不完整契約送進 worker', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({ referenceVideoWindow: undefined }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('DEPTH_REBUILD_DUAL_GUIDE_WINDOW_REQUIRED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'workflowId', overrides: { workflowId: undefined } },
    { label: 'segmentIndex', overrides: { segmentIndex: undefined } },
    { label: 'segmentCount', overrides: { segmentCount: undefined } },
    { label: '越界 index', overrides: { segmentIndex: 2 } },
  ])('RGB＋Depth 缺少或無效 $label -> 400，不建立任務', async ({ overrides }) => {
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody(overrides),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect((await response.json()).error.details.code)
      .toBe('DEPTH_REBUILD_SEGMENT_IDENTITY_INVALID')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('一般 Playground 任務夾帶分段身分 -> 400', async () => {
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({ workflowId: 'workflow_1', segmentIndex: 0, segmentCount: 1 }),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect((await response.json()).error.details.code)
      .toBe('DEPTH_REBUILD_SEGMENT_IDENTITY_REQUIRES_DUAL_GUIDE')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('RGB＋Depth 輸出秒數與同步窗不一致 -> 400', async () => {
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({ durationSec: 5.4 }),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect((await response.json()).error.details.code)
      .toBe('DEPTH_REBUILD_DURATION_WINDOW_MISMATCH')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: '負數起點',
      referenceVideoWindow: { startSeconds: -0.1, durationSeconds: 5.5 },
    },
    {
      label: '少於 4 秒',
      referenceVideoWindow: { startSeconds: 0, durationSeconds: 3.99 },
    },
    {
      label: '結束超過來源前 15 秒',
      referenceVideoWindow: { startSeconds: 10, durationSeconds: 5.5 },
    },
  ])('RGB＋Depth 同步窗不合法：$label -> 400', async ({ referenceVideoWindow }) => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({ referenceVideoWindow }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('REFERENCE_VIDEO_WINDOW_INVALID')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('RGB＋Depth 各 7.51 秒 -> 參考總時長超過 15 秒，付費前顯式拒絕', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({
        referenceVideoWindow: { startSeconds: 0, durationSeconds: 7.51 },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('DEPTH_REBUILD_REFERENCE_DURATION_OVER_LIMIT')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('RGB＋Depth 各 7.5 秒 -> 總時長剛好 15 秒，允許建立任務', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({
        referenceVideoWindow: { startSeconds: 0, durationSeconds: 7.5 },
        durationSec: 7.5,
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(submitterMock.submitTask).toHaveBeenCalledOnce()
  })

  it('RGB＋Depth 缺 sourceAudioMode -> 400，避免 API 接受後才由 worker 失敗', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({ sourceAudioMode: undefined }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('DEPTH_REBUILD_DUAL_GUIDE_CONTRACT_INVALID')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('RGB＋Depth 分段要求 preserve -> 400，原音只能在最終完稿統一封裝', async () => {
    const { POST } = await loadRoute()
    const response = await POST(buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: dualGuideBody({ sourceAudioMode: 'preserve' }),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect((await response.json()).error.details.code)
      .toBe('DEPTH_REBUILD_DUAL_GUIDE_CONTRACT_INVALID')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it.each([
    'preserve',
    'reference-only',
    'generate',
  ])('sourceAudioMode=%s -> payload 只傳新契約，不混入舊音訊旗標', async (sourceAudioMode) => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({ sourceAudioMode }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const payload = submitterMock.submitTask.mock.calls.at(-1)?.[0]?.payload as
      | Record<string, unknown>
      | undefined
    expect(payload).toMatchObject({
      sourceAudioMode,
      normalizeSeedanceReferenceVideo: true,
      referenceVideos: ['video/playground-ref/user-1/depth.webm'],
    })
    expect(payload).not.toHaveProperty('preserveSourceAudio')
    expect(payload).not.toHaveProperty('generateAudio')
  })

  it('未知 sourceAudioMode -> 400 且不建立任務', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({ sourceAudioMode: 'copy-maybe' }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('SOURCE_AUDIO_MODE_INVALID')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'preserveSourceAudio', preserveSourceAudio: false },
    { label: 'generateAudio', generateAudio: false },
  ])('新模式混用舊旗標 $label -> 400', async ({ label: _label, ...legacyFlag }) => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({ sourceAudioMode: 'preserve', ...legacyFlag }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('SOURCE_AUDIO_MODE_LEGACY_FLAGS_CONFLICT')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('新模式沒有要求影片正規化 -> 400，不允許隱式降級', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({
        sourceAudioMode: 'preserve',
        normalizeSeedanceReferenceVideo: false,
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('SOURCE_AUDIO_MODE_REQUIRES_NORMALIZATION')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('外部 HTTPS 影片要求正規化 -> 403 且不讓 ffmpeg 取得任意網址', async () => {
    guardMock.filterAuthorizedStorageReferences.mockResolvedValue({
      safe: [],
      rejected: ['https://attacker.example/depth.webm'],
    })
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({ referenceVideos: ['https://attacker.example/depth.webm'] }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.error.details.code)
      .toBe('SEEDANCE_REFERENCE_NORMALIZATION_REFERENCE_NOT_TRUSTED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('非 AtlasCloud Seedance 2.0 R2V 模型 -> 400 且不建立付費任務', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({ modelKey: 'fal::bytedance/seedance-2.0/reference-to-video' }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('SEEDANCE_REFERENCE_NORMALIZATION_MODEL_UNSUPPORTED')
    expect(json.error.details.details.modelKey)
      .toBe('fal::bytedance/seedance-2.0/reference-to-video')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('沒有唯一參考影片 -> 400 且回報實際數量0', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({ referenceVideos: [] }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('SEEDANCE_REFERENCE_NORMALIZATION_REFERENCE_COUNT_INVALID')
    expect(json.error.details.details.got).toBe(0)
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('圖片輸出要求影片正規化 -> 400，不允許跨 output type', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({
        outputType: 'image',
        modelKey: 'atlascloud::seedance-2.0-r2v',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('SEEDANCE_REFERENCE_NORMALIZATION_REQUIRES_VIDEO_OUTPUT')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('旗標不是 boolean -> 400，不做 truthy coercion', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: body({ normalizeSeedanceReferenceVideo: 'true' }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.details.code).toBe('SEEDANCE_REFERENCE_NORMALIZATION_INVALID')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('帶穩定請求識別碼 -> 以使用者範圍雜湊為資料庫唯一 dedupe key', async () => {
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      headers: { 'Idempotency-Key': 'depth-client-request-001' },
      body: body(),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(submitterMock.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: expect.stringMatching(/^playground_http:[a-f0-9]{64}$/),
        dedupeMode: 'idempotent',
      }),
    )
  })

  it('相同請求識別碼已有 Task -> 直接回傳既有任務，不再凍結或送出', async () => {
    prismaMock.task.findFirst.mockResolvedValue({
      id: 'task-existing',
      status: 'processing',
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
      finishedAt: null,
    })
    const { POST } = await loadRoute()
    const request = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      headers: { 'Idempotency-Key': 'depth-client-request-001' },
      body: body(),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.run.id).toBe('task-existing')
    expect(prismaMock.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
      }),
    )
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })
})
