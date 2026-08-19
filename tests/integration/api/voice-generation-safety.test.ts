import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const submitTaskMock = vi.hoisted(() => Object.assign(vi.fn(), {
  preflightIdempotentTaskBatch: vi.fn(),
}))
const hasOutputMock = vi.hoisted(() => vi.fn(async () => false))
const resolverMock = vi.hoisted(() => vi.fn())
const apiConfigMock = vi.hoisted(() => ({
  resolveAtlasCloudSeedAudioConfiguration: vi.fn(),
}))
const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
  },
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
  preflightIdempotentTaskBatch: submitTaskMock.preflightIdempotentTaskBatch,
}))
vi.mock('@/lib/task/has-output', () => ({ hasVoiceLineAudioOutput: hasOutputMock }))
vi.mock('@/lib/task/resolve-locale', () => ({ resolveRequiredTaskLocale: () => 'zh' }))
vi.mock('@/lib/billing', () => ({ buildDefaultTaskBillingInfo: () => ({ billable: true }) }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/voice/voice-generation-scope', async () => {
  const actual = await vi.importActual<typeof import('@/lib/voice/voice-generation-scope')>(
    '@/lib/voice/voice-generation-scope',
  )
  return {
    ...actual,
    resolveVoiceLineGenerationInput: resolverMock,
  }
})

import {
  VoiceGenerationScopeError,
  voiceLineGenerationFingerprint,
} from '@/lib/voice/voice-generation-scope'
import { TASK_TYPE } from '@/lib/task/types'

const REQUESTED_AUDIO_MODEL = 'atlascloud::bytedance/seed-audio-1.0'
const PINNED_AUDIO_MODEL = 'atlascloud::bytedance/seed-audio-1.0'
const CLIENT_REQUEST_ID = '11111111-1111-4111-8111-111111111111'

function safeResolvedLine(id: string) {
  return {
    line: {
      id,
      episodeId: 'episode-a',
      speaker: 'Ann',
      content: 'Hello voice line',
      voicePresetId: null,
      emotionPrompt: null,
      emotionStrength: 0.4,
      speakerVoices: JSON.stringify({ Ann: { voicePresetId: 'preset-system' } }),
      audioUrl: null,
      audioMediaId: null,
      audioDuration: null,
    },
    source: {
      presetId: 'preset-system',
      kind: 'storage-key' as const,
      value: 'voice/system/ann.wav',
    },
  }
}

describe('voice-generate fail-closed route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-a' })
    prismaMock.task.findMany.mockResolvedValue([])
    resolverMock.mockResolvedValue(safeResolvedLine('line-a'))
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockResolvedValue({
      selection: {
        provider: 'atlascloud',
        modelId: 'bytedance/seed-audio-1.0',
        modelKey: PINNED_AUDIO_MODEL,
        mediaType: 'audio',
      },
      provider: {
        id: 'atlascloud',
        name: 'AtlasCloud',
        apiKey: 'atlas-key',
      },
    })
    submitTaskMock.mockResolvedValue({ taskId: 'task-a', async: true })
    submitTaskMock.preflightIdempotentTaskBatch.mockResolvedValue(undefined)
  })

  it('[foreign project/episode/line] -> [404 且 0 hasOutput / 0 submitTask]', async () => {
    resolverMock.mockRejectedValueOnce(new VoiceGenerationScopeError('VOICE_LINE_SCOPE_MISMATCH'))

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: { episodeId: 'episode-a', lineId: 'line-from-project-b', clientRequestId: CLIENT_REQUEST_ID },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(404)
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it.each([
    'VOICE_SOURCE_CONSENT_REQUIRED',
    'VOICE_PRESET_NOT_TRUSTED',
    'VOICE_PRESET_MEDIA_INVALID',
  ] as const)('[不可信來源 %s] -> [400 且不得凍結費用或提交 task]', async (code) => {
    resolverMock.mockRejectedValueOnce(new VoiceGenerationScopeError(code))

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: { episodeId: 'episode-a', lineId: 'line-a', clientRequestId: CLIENT_REQUEST_ID },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    const json = await response.json() as { error?: { details?: { reason?: string } } }
    expect(json.error?.details?.reason).toBe(code)
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[batch 中第二行來源不可信] -> [先驗完全部再提交，0 partial submit]', async () => {
    resolverMock
      .mockResolvedValueOnce(safeResolvedLine('line-a'))
      .mockRejectedValueOnce(new VoiceGenerationScopeError('VOICE_SOURCE_CONSENT_REQUIRED'))

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-a', 'line-b'],
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionVoiceLine.findMany).not.toHaveBeenCalled()
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[requested model + canonical scoped line] -> [payload pin resolved model 與 64hex source fingerprint]', async () => {
    const resolved = safeResolvedLine('line-canonical')
    resolverMock.mockResolvedValueOnce(resolved)

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-a',
        lineId: 'line-canonical',
        audioModel: REQUESTED_AUDIO_MODEL,
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).toHaveBeenCalledWith('user-a')
    expect(hasOutputMock).toHaveBeenCalledWith('line-canonical')
    const submitInput = submitTaskMock.mock.calls[0]?.[0] as {
      payload: {
        audioModel: string
        providerText: string
        sourceFingerprint: string
        generationInput: ReturnType<typeof safeResolvedLine>
      }
    }
    expect(submitInput).toEqual(expect.objectContaining({
      projectId: 'project-a',
      episodeId: 'episode-a',
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-canonical',
      payload: expect.objectContaining({
        episodeId: 'episode-a',
        lineId: 'line-canonical',
      }),
    }))
    expect(submitInput.payload.audioModel).toBe(PINNED_AUDIO_MODEL)
    expect(submitInput.payload.providerText).toBe('@audio1 Hello voice line')
    expect(submitInput.payload.generationInput).toEqual(resolved)
    expect(submitInput.payload.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(submitInput.payload.sourceFingerprint).toBe(voiceLineGenerationFingerprint({
      line: resolved.line,
      source: resolved.source,
      audioModel: PINNED_AUDIO_MODEL,
    }))
  })

  it('[Atlas audio model is not configured] -> [actionable 400 且 0 source resolve / 0 submit]', async () => {
    const { AtlasCloudSeedAudioConfigError } = await import(
      '@/lib/voice/atlascloud-seed-audio-contract'
    )
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockRejectedValueOnce(
      new AtlasCloudSeedAudioConfigError(
        'ATLAS_AUDIO_MODEL_NOT_CONFIGURED',
        '請先在 /profile 啟用 AtlasCloud Seed Audio 1.0 配音模型',
      ),
    )

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: { episodeId: 'episode-a', lineId: 'line-a', clientRequestId: CLIENT_REQUEST_ID },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    const json = await response.json() as {
      error?: { code?: string; details?: { code?: string; setupPath?: string } }
    }
    expect(json.error?.code).toBe('MISSING_CONFIG')
    expect(json.error?.details?.code).toBe('ATLAS_AUDIO_MODEL_NOT_CONFIGURED')
    expect(json.error?.details?.setupPath).toBe('/profile')
    expect(resolverMock).not.toHaveBeenCalled()
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[client requests legacy FAL audio model] -> [400 且 Atlas resolver / source / task 都不執行]', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-a',
        lineId: 'line-a',
        audioModel: 'fal::fal-ai/index-tts-2/text-to-speech',
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    const json = await response.json() as { error?: { details?: { code?: string } } }
    expect(json.error?.details?.code).toBe('AUDIO_MODEL_UNSUPPORTED')
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).not.toHaveBeenCalled()
    expect(resolverMock).not.toHaveBeenCalled()
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[client requests a different Atlas provider instance] -> [400 and never silently switches credentials]', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-a',
        lineId: 'line-a',
        audioModel: 'atlascloud:primary::bytedance/seed-audio-1.0',
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'INVALID_PARAMS',
        details: { code: 'AUDIO_MODEL_SELECTION_MISMATCH' },
      },
    })
    expect(resolverMock).not.toHaveBeenCalled()
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[invalid clientRequestId] -> [400 before model config, DB scope, billing, or submit]', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-a',
        lineId: 'line-a',
        clientRequestId: 'not-a-uuid',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'INVALID_PARAMS',
        details: { code: 'CLIENT_REQUEST_ID_INVALID' },
      },
    })
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).not.toHaveBeenCalled()
    expect(resolverMock).not.toHaveBeenCalled()
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'missing', lineIds: undefined },
    { label: 'empty', lineIds: [] },
    { label: 'duplicate', lineIds: ['line-a', 'line-a'] },
    { label: 'blank', lineIds: ['line-a', ' '] },
  ])('[batch $label lineIds] -> [400 before config, scope, billing, or submit]', async ({ lineIds }) => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-a',
        all: true,
        ...(lineIds === undefined ? {} : { lineIds }),
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'INVALID_PARAMS',
        details: { code: 'VOICE_LINE_IDS_INVALID' },
      },
    })
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).not.toHaveBeenCalled()
    expect(resolverMock).not.toHaveBeenCalled()
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[single replay with same UUID and immutable input] -> [same dedupe key/fingerprint in idempotent mode]', async () => {
    submitTaskMock
      .mockResolvedValueOnce({ taskId: 'task-a', async: true })
      .mockResolvedValueOnce({ taskId: 'task-a', async: true })
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const request = {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST' as const,
      body: {
        episodeId: 'episode-a',
        lineId: 'line-a',
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    }

    const first = await callRoute(POST as never, request)
    const second = await callRoute(POST as never, request)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstSubmit = submitTaskMock.mock.calls[0]?.[0] as {
      dedupeKey: string
      dedupeMode: string
      payload: { clientRequestId: string; idempotencyFingerprint: string }
    }
    const secondSubmit = submitTaskMock.mock.calls[1]?.[0] as typeof firstSubmit
    expect(firstSubmit.dedupeKey).toBe('voice_line:line-a')
    expect(firstSubmit.dedupeMode).toBe('active')
    expect((firstSubmit as { idempotencyTaskId?: string }).idempotencyTaskId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(firstSubmit.payload.clientRequestId).toBe(CLIENT_REQUEST_ID)
    expect(firstSubmit.payload.idempotencyFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect((secondSubmit as { idempotencyTaskId?: string }).idempotencyTaskId).toBe(
      (firstSubmit as { idempotencyTaskId?: string }).idempotencyTaskId,
    )
    expect(secondSubmit.dedupeKey).toBe(firstSubmit.dedupeKey)
    expect(secondSubmit.payload.idempotencyFingerprint).toBe(
      firstSubmit.payload.idempotencyFingerprint,
    )
  })

  it('[accepted single response is lost, then line/config/source change] -> [exact Task replay returns before current config, source, output, billing, or queue work]', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const request = {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST' as const,
      body: {
        episodeId: 'episode-a',
        lineId: 'line-a',
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    }

    expect((await callRoute(POST as never, request)).status).toBe(200)
    const accepted = submitTaskMock.mock.calls[0]?.[0] as {
      idempotencyTaskId: string
      targetId: string
      payload: Record<string, unknown>
    }
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: accepted.idempotencyTaskId,
      userId: 'user-a',
      projectId: 'project-a',
      episodeId: 'episode-a',
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'NovelPromotionVoiceLine',
      targetId: accepted.targetId,
      payload: accepted.payload,
    }])
    prismaMock.novelPromotionEpisode.findFirst.mockClear()
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockClear()
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockRejectedValue(
      new Error('model was disabled after acceptance'),
    )
    resolverMock.mockClear()
    resolverMock.mockRejectedValue(new Error('preset was removed after acceptance'))
    hasOutputMock.mockClear()
    submitTaskMock.mockClear()

    const replay = await callRoute(POST as never, request)

    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({
      success: true,
      async: true,
      taskId: accepted.idempotencyTaskId,
    })
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).not.toHaveBeenCalled()
    expect(resolverMock).not.toHaveBeenCalled()
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockReset()
    resolverMock.mockReset()
  })

  it('[same UUID changes batch membership after acceptance] -> [409 before config/source and zero new Task submit]', async () => {
    resolverMock.mockImplementation(async ({ lineId }: { lineId: string }) => safeResolvedLine(lineId))
    submitTaskMock.mockImplementation(async ({ targetId }: { targetId: string }) => ({
      taskId: `task-${targetId}`,
      async: true,
    }))
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const firstRequest = {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST' as const,
      body: {
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-b', 'line-a'],
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    }
    expect((await callRoute(POST as never, firstRequest)).status).toBe(200)
    const accepted = submitTaskMock.mock.calls.map(([input]) => input as {
      idempotencyTaskId: string
      targetId: string
      payload: Record<string, unknown>
    })
    prismaMock.task.findMany.mockResolvedValueOnce(accepted.map((input) => ({
      id: input.idempotencyTaskId,
      userId: 'user-a',
      projectId: 'project-a',
      episodeId: 'episode-a',
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'NovelPromotionVoiceLine',
      targetId: input.targetId,
      payload: input.payload,
    })))
    apiConfigMock.resolveAtlasCloudSeedAudioConfiguration.mockClear()
    resolverMock.mockClear()
    hasOutputMock.mockClear()
    submitTaskMock.mockClear()

    const changed = await callRoute(POST as never, {
      ...firstRequest,
      body: {
        ...firstRequest.body,
        lineIds: ['line-a', 'line-b', 'line-c'],
      },
    })

    expect(changed.status).toBe(409)
    expect(await changed.json()).toMatchObject({
      error: {
        code: 'CONFLICT',
        details: { code: 'TASK_IDEMPOTENCY_CONFLICT' },
      },
    })
    expect(apiConfigMock.resolveAtlasCloudSeedAudioConfiguration).not.toHaveBeenCalled()
    expect(resolverMock).not.toHaveBeenCalled()
    expect(hasOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[same UUID reorders the same accepted batch] -> [canonical membership replays exact task IDs without resubmission]', async () => {
    resolverMock.mockImplementation(async ({ lineId }: { lineId: string }) => safeResolvedLine(lineId))
    submitTaskMock.mockImplementation(async ({ targetId }: { targetId: string }) => ({
      taskId: `task-${targetId}`,
      async: true,
    }))
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const base = {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST' as const,
      body: {
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-a', 'line-b'],
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    }
    expect((await callRoute(POST as never, base)).status).toBe(200)
    const accepted = submitTaskMock.mock.calls.map(([input]) => input as {
      idempotencyTaskId: string
      targetId: string
      payload: Record<string, unknown>
    })
    prismaMock.task.findMany.mockResolvedValueOnce(accepted.map((input) => ({
      id: input.idempotencyTaskId,
      userId: 'user-a',
      projectId: 'project-a',
      episodeId: 'episode-a',
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'NovelPromotionVoiceLine',
      targetId: input.targetId,
      payload: input.payload,
    })))
    submitTaskMock.mockClear()
    resolverMock.mockClear()

    const replay = await callRoute(POST as never, {
      ...base,
      body: { ...base.body, lineIds: ['line-b', 'line-a'] },
    })

    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({
      success: true,
      async: true,
      taskIds: accepted
        .sort((left, right) => left.targetId.localeCompare(right.targetId))
        .map((input) => input.idempotencyTaskId),
      total: 2,
    })
    expect(resolverMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[same UUID switches one accepted line from single to batch] -> [409 before any new submission]', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const single = {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST' as const,
      body: { episodeId: 'episode-a', lineId: 'line-a', clientRequestId: CLIENT_REQUEST_ID },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    }
    expect((await callRoute(POST as never, single)).status).toBe(200)
    const accepted = submitTaskMock.mock.calls[0]?.[0] as {
      idempotencyTaskId: string
      targetId: string
      payload: Record<string, unknown>
    }
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: accepted.idempotencyTaskId,
      userId: 'user-a',
      projectId: 'project-a',
      episodeId: 'episode-a',
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'NovelPromotionVoiceLine',
      targetId: accepted.targetId,
      payload: accepted.payload,
    }])
    submitTaskMock.mockClear()

    const changed = await callRoute(POST as never, {
      ...single,
      body: {
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-a'],
        clientRequestId: CLIENT_REQUEST_ID,
      },
    })

    expect(changed.status).toBe(409)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[batch replay] -> [one request UUID derives stable distinct per-line keys after all inputs are prevalidated]', async () => {
    resolverMock.mockImplementation(async ({ lineId }: { lineId: string }) => safeResolvedLine(lineId))
    submitTaskMock.mockImplementation(async ({ targetId }: { targetId: string }) => ({
      taskId: `task-${targetId}`,
      async: true,
    }))
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const request = {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST' as const,
      body: {
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-a', 'line-b'],
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    }

    const first = await callRoute(POST as never, request)
    const second = await callRoute(POST as never, request)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(resolverMock).toHaveBeenCalledTimes(4)
    expect(hasOutputMock).toHaveBeenCalledTimes(4)
    expect(submitTaskMock).toHaveBeenCalledTimes(4)
    expect(submitTaskMock.preflightIdempotentTaskBatch).toHaveBeenCalledTimes(2)
    const firstPreflight = submitTaskMock.preflightIdempotentTaskBatch.mock.calls[0]?.[0] as {
      requests: Array<{ idempotencyTaskId: string; payload: { idempotencyFingerprint: string } }>
    }
    expect(firstPreflight.requests).toHaveLength(2)
    const submissions = submitTaskMock.mock.calls.map(([input]) => input as {
      targetId: string
      idempotencyTaskId: string
      dedupeKey: string
      dedupeMode: string
      payload: { idempotencyFingerprint: string }
    })
    const firstByLine = new Map(submissions.slice(0, 2).map((item) => [item.targetId, item]))
    const replayByLine = new Map(submissions.slice(2).map((item) => [item.targetId, item]))
    expect(firstByLine.get('line-a')?.idempotencyTaskId).not.toBe(
      firstByLine.get('line-b')?.idempotencyTaskId,
    )
    expect(firstByLine.get('line-a')?.dedupeKey).toBe('voice_line:line-a')
    expect(firstByLine.get('line-b')?.dedupeKey).toBe('voice_line:line-b')
    for (const lineId of ['line-a', 'line-b']) {
      expect(firstByLine.get(lineId)?.dedupeMode).toBe('active')
      expect(replayByLine.get(lineId)?.idempotencyTaskId).toBe(
        firstByLine.get(lineId)?.idempotencyTaskId,
      )
      expect(replayByLine.get(lineId)?.dedupeKey).toBe(firstByLine.get(lineId)?.dedupeKey)
      expect(replayByLine.get(lineId)?.payload.idempotencyFingerprint).toBe(
        firstByLine.get(lineId)?.payload.idempotencyFingerprint,
      )
    }
    // No Task may start until all scoped lines and all output-state reads finish.
    expect(resolverMock.mock.invocationCallOrder[1]).toBeLessThan(
      submitTaskMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
    expect(hasOutputMock.mock.invocationCallOrder[1]).toBeLessThan(
      submitTaskMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
  })

  it('[batch idempotency preflight finds one changed existing line] -> [0 Task submission for every line]', async () => {
    resolverMock.mockImplementation(async ({ lineId }: { lineId: string }) => safeResolvedLine(lineId))
    submitTaskMock.preflightIdempotentTaskBatch.mockRejectedValueOnce(Object.assign(
      new Error('TASK_IDEMPOTENCY_CONFLICT'),
      { code: 'CONFLICT', status: 409, details: { code: 'TASK_IDEMPOTENCY_CONFLICT' } },
    ))
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')

    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-a', 'line-b'],
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(409)
    expect(submitTaskMock.preflightIdempotentTaskBatch).toHaveBeenCalledWith({
      requests: expect.arrayContaining([
        expect.objectContaining({
          idempotencyTaskId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      ]),
    })
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[same UUID/line but changed provider-visible input] -> [same key and different fingerprint for service conflict]', async () => {
    const firstResolved = safeResolvedLine('line-a')
    const changedResolved = {
      ...safeResolvedLine('line-a'),
      line: { ...safeResolvedLine('line-a').line, content: 'Changed dialogue' },
    }
    resolverMock
      .mockResolvedValueOnce(firstResolved)
      .mockResolvedValueOnce(changedResolved)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const request = {
      path: '/api/novel-promotion/project-a/voice-generate',
      method: 'POST' as const,
      body: {
        episodeId: 'episode-a',
        lineId: 'line-a',
        clientRequestId: CLIENT_REQUEST_ID,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    }

    expect((await callRoute(POST as never, request)).status).toBe(200)
    expect((await callRoute(POST as never, request)).status).toBe(200)
    const firstSubmit = submitTaskMock.mock.calls[0]?.[0] as {
      dedupeKey: string
      payload: { idempotencyFingerprint: string }
    }
    const changedSubmit = submitTaskMock.mock.calls[1]?.[0] as typeof firstSubmit
    expect(changedSubmit.dedupeKey).toBe(firstSubmit.dedupeKey)
    expect(changedSubmit.payload.idempotencyFingerprint).not.toBe(
      firstSubmit.payload.idempotencyFingerprint,
    )
  })
})
