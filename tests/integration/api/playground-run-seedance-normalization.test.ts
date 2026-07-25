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
    expect(json.error.details.code).toBe('SEEDANCE_REFERENCE_NORMALIZATION_REQUIRES_ONE_VIDEO')
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
