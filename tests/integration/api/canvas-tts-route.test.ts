import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

installAuthMocks()

const submitMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const apiConfigMock = vi.hoisted(() => ({
  resolveAtlasCloudSeedAudioConfiguration: vi.fn(),
}))
const estimatorMock = vi.hoisted(() => ({
  estimateVoiceLineMaxSeconds: vi.fn(() => 17),
}))
const prismaMock = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/task/submitter', () => submitMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/voice/generate-voice-line', () => estimatorMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

type RouteModule = typeof import('@/app/api/canvas/tts/route')
let route: RouteModule

beforeAll(async () => {
  route = await import('@/app/api/canvas/tts/route')
})

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/canvas/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/canvas/tts AtlasCloud task contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMockState()
    mockAuthenticated('user-1')
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockResolvedValue({
      selection: {
        provider: 'atlascloud:primary',
        modelId: 'bytedance/seed-audio-1.0',
        modelKey: 'atlascloud:primary::bytedance/seed-audio-1.0',
        mediaType: 'audio',
      },
      provider: {
        id: 'atlascloud:primary',
        name: 'AtlasCloud Primary',
        apiKey: 'atlas-key',
      },
    })
    estimatorMock.estimateVoiceLineMaxSeconds.mockReturnValue(17)
    prismaMock.task.findUnique.mockResolvedValue(null)
    submitMock.submitTask.mockResolvedValue({
      taskId: 'task-canvas-tts-1',
      runId: 'run-canvas-tts-1',
      status: 'queued',
    })
  })

  it('[valid reference and Atlas config] -> [pins exact model key and provider-visible text before submission]', async () => {
    const response = await route.POST(request({
      text: '  你好😀  ',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      emotionPrompt: ' 溫柔 ',
      strength: 0.6,
      locale: 'zh',
      clientRequestId: '11111111-1111-4111-8111-111111111111',
    }), {} as never)

    expect(response.status).toBe(200)
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).toHaveBeenCalledWith('user-1')
    expect(estimatorMock.estimateVoiceLineMaxSeconds).toHaveBeenCalledWith('你好😀')
    expect(submitMock.submitTask.mock.calls.at(-1)?.[0]).toMatchObject({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'playground',
      type: 'canvas_tts',
      targetType: 'canvas-tts',
      dedupeKey: expect.stringMatching(/^canvas-tts:v1:[a-f0-9]{64}$/),
      dedupeMode: 'idempotent',
      payload: {
        text: '你好😀',
        referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
        emotionPrompt: '溫柔',
        strength: 0.6,
        maxSeconds: 17,
        audioModel: 'atlascloud:primary::bytedance/seed-audio-1.0',
        providerText: '@audio1 [emotion: 溫柔; intensity: 0.6] 你好😀',
        clientRequestId: '11111111-1111-4111-8111-111111111111',
        idempotencyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(await response.json()).toEqual({
      success: true,
      taskId: 'task-canvas-tts-1',
      runId: 'run-canvas-tts-1',
      status: 'queued',
    })
  })

  it('[Atlas audio config is missing] -> [returns actionable 400 and submits no task]', async () => {
    const { AtlasCloudSeedAudioConfigError } = await import(
      '@/lib/voice/atlascloud-seed-audio-contract'
    )
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockRejectedValueOnce(
      new AtlasCloudSeedAudioConfigError(
        'ATLAS_AUDIO_API_KEY_MISSING',
        '請先在 /profile 填入 AtlasCloud API Key',
      ),
    )

    const response = await route.POST(request({
      text: '你好',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      clientRequestId: '22222222-2222-4222-8222-222222222222',
    }), {} as never)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'MISSING_CONFIG',
        details: {
          code: 'ATLAS_AUDIO_API_KEY_MISSING',
          setupPath: '/profile',
        },
      },
    })
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('[emotion strength is below the supported prompt range] -> [pins the minimum deterministic value]', async () => {
    const response = await route.POST(request({
      text: '你好',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      emotionPrompt: '溫柔',
      strength: 0,
      clientRequestId: '33333333-3333-4333-8333-333333333333',
    }), {} as never)

    expect(response.status).toBe(200)
    expect(submitMock.submitTask.mock.calls.at(-1)?.[0]).toMatchObject({
      payload: {
        strength: 0.1,
        providerText: '@audio1 [emotion: 溫柔; intensity: 0.1] 你好',
      },
    })
  })

  it('[clientRequestId is missing or malformed] -> [returns 400 before config resolution and submission]', async () => {
    const response = await route.POST(request({
      text: '你好',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      clientRequestId: 'not-a-uuid',
    }), {} as never)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { details: { code: 'CLIENT_REQUEST_ID_INVALID' } },
    })
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).not.toHaveBeenCalled()
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('[same clientRequestId and normalized payload] -> [pins a stable dedupe key and fingerprint]', async () => {
    const body = {
      text: '你好',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      emotionPrompt: '溫柔',
      strength: 0.6,
      locale: 'zh',
      clientRequestId: '44444444-4444-4444-8444-444444444444',
    }

    expect((await route.POST(request(body), {} as never)).status).toBe(200)
    expect((await route.POST(request({ ...body, text: '  你好  ' }), {} as never)).status).toBe(200)

    const first = submitMock.submitTask.mock.calls.at(-2)?.[0]
    const second = submitMock.submitTask.mock.calls.at(-1)?.[0]
    expect(second.dedupeKey).toBe(first.dedupeKey)
    expect(second.payload.idempotencyFingerprint).toBe(first.payload.idempotencyFingerprint)
  })

  it('[same clientRequestId but different text] -> [keeps one dedupe identity and pins a different request fingerprint]', async () => {
    const clientRequestId = '55555555-5555-4555-8555-555555555555'
    const base = {
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      clientRequestId,
    }

    expect((await route.POST(request({ ...base, text: '第一句' }), {} as never)).status).toBe(200)
    expect((await route.POST(request({ ...base, text: '不同的第二句' }), {} as never)).status).toBe(200)

    const first = submitMock.submitTask.mock.calls.at(-2)?.[0]
    const second = submitMock.submitTask.mock.calls.at(-1)?.[0]
    expect(second.dedupeKey).toBe(first.dedupeKey)
    expect(second.payload.idempotencyFingerprint).not.toBe(first.payload.idempotencyFingerprint)
  })

  it('[accepted response is lost and Atlas config is later disabled] -> [exact historical Task replays before config or submit]', async () => {
    const body = {
      text: '不可重複付費的配音',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      emotionPrompt: '溫柔',
      strength: 0.6,
      locale: 'zh',
      clientRequestId: '88888888-8888-4888-8888-888888888888',
    }

    expect((await route.POST(request(body), {} as never)).status).toBe(200)
    const accepted = submitMock.submitTask.mock.calls.at(-1)?.[0] as {
      dedupeKey: string
      targetId: string
      payload: Record<string, unknown>
    }
    prismaMock.task.findUnique.mockResolvedValueOnce({
      id: 'task-canvas-tts-1',
      userId: 'user-1',
      projectId: 'playground',
      type: 'canvas_tts',
      targetType: 'canvas-tts',
      targetId: accepted.targetId,
      status: 'completed',
      payload: {
        ...accepted.payload,
        runId: 'run-canvas-tts-1',
      },
    })
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockClear()
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockRejectedValue(
      new Error('Atlas config disabled after task acceptance'),
    )
    submitMock.submitTask.mockClear()

    const replay = await route.POST(request(body), {} as never)

    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({
      success: true,
      taskId: 'task-canvas-tts-1',
      runId: 'run-canvas-tts-1',
      status: 'completed',
    })
    expect(prismaMock.task.findUnique).toHaveBeenLastCalledWith({
      where: { dedupeKey: accepted.dedupeKey },
      select: {
        id: true,
        userId: true,
        projectId: true,
        type: true,
        targetType: true,
        targetId: true,
        status: true,
        payload: true,
      },
    })
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).not.toHaveBeenCalled()
    expect(estimatorMock.estimateVoiceLineMaxSeconds).toHaveBeenCalledTimes(1)
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('[same Canvas clientRequestId is replayed with a changed body] -> [409 before config or submit]', async () => {
    const clientRequestId = '99999999-9999-4999-8999-999999999999'
    const originalBody = {
      text: '原始內容',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      locale: 'zh',
      clientRequestId,
    }
    expect((await route.POST(request(originalBody), {} as never)).status).toBe(200)
    const accepted = submitMock.submitTask.mock.calls.at(-1)?.[0] as {
      targetId: string
      payload: Record<string, unknown>
    }
    prismaMock.task.findUnique.mockResolvedValueOnce({
      id: 'task-canvas-tts-original',
      userId: 'user-1',
      projectId: 'playground',
      type: 'canvas_tts',
      targetType: 'canvas-tts',
      targetId: accepted.targetId,
      status: 'queued',
      payload: accepted.payload,
    })
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockClear()
    submitMock.submitTask.mockClear()

    const conflict = await route.POST(request({
      ...originalBody,
      text: '已變更內容',
    }), {} as never)

    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      error: {
        code: 'CONFLICT',
        details: { code: 'TASK_IDEMPOTENCY_CONFLICT' },
      },
    })
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).not.toHaveBeenCalled()
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it.each([
    ['user', { userId: 'user-other' }],
    ['project', { projectId: 'project-other' }],
    ['type', { type: 'canvas_text' }],
    ['target type', { targetType: 'canvas-text' }],
    ['target id', { targetId: '' }],
  ] as const)('[historical dedupe row has wrong %s scope] -> [409 before Atlas config or submit]', async (_label, overrides) => {
    const body = {
      text: '嚴格範圍驗證',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      locale: 'zh',
      clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }
    expect((await route.POST(request(body), {} as never)).status).toBe(200)
    const accepted = submitMock.submitTask.mock.calls.at(-1)?.[0] as {
      targetId: string
      payload: Record<string, unknown>
    }
    prismaMock.task.findUnique.mockResolvedValueOnce({
      id: 'task-canvas-tts-scope',
      userId: 'user-1',
      projectId: 'playground',
      type: 'canvas_tts',
      targetType: 'canvas-tts',
      targetId: accepted.targetId,
      status: 'queued',
      payload: accepted.payload,
      ...overrides,
    })
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockClear()
    submitMock.submitTask.mockClear()

    const conflict = await route.POST(request(body), {} as never)

    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      error: {
        code: 'CONFLICT',
        details: { code: 'TASK_IDEMPOTENCY_CONFLICT' },
      },
    })
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).not.toHaveBeenCalled()
    expect(submitMock.submitTask).not.toHaveBeenCalled()
  })

  it('[user starts a new Canvas TTS request after a terminal attempt] -> [a new clientRequestId creates a distinct logical task identity]', async () => {
    const base = {
      text: '重新配音',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
    }

    expect((await route.POST(request({
      ...base,
      clientRequestId: '66666666-6666-4666-8666-666666666666',
    }), {} as never)).status).toBe(200)
    expect((await route.POST(request({
      ...base,
      clientRequestId: '77777777-7777-4777-8777-777777777777',
    }), {} as never)).status).toBe(200)

    const first = submitMock.submitTask.mock.calls.at(-2)?.[0]
    const second = submitMock.submitTask.mock.calls.at(-1)?.[0]
    expect(second.dedupeKey).not.toBe(first.dedupeKey)
    // The immutable request payload is identical; only the client-owned
    // logical-attempt identity changes.
    expect(second.payload.idempotencyFingerprint).toBe(first.payload.idempotencyFingerprint)
    expect(first.dedupeMode).toBe('idempotent')
    expect(second.dedupeMode).toBe('idempotent')
  })
})
