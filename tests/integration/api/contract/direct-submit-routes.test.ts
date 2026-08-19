import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import { buildMockRequest } from '../../../helpers/request'
import { ApiError } from '@/lib/api-errors'

vi.mock('server-only', () => ({}))

type AuthState = {
  authenticated: boolean
  projectMode: 'novel-promotion' | 'other'
}

type SubmitResult = {
  taskId: string
  async: true
}

type RouteContext = {
  params: Promise<Record<string, string>>
}

type DirectRouteCase = {
  routeFile: string
  body: Record<string, unknown>
  params?: Record<string, string>
  expectedTaskType: TaskType
  expectedTargetType: string
  expectedProjectId: string
}

const authState = vi.hoisted<AuthState>(() => ({
  authenticated: true,
  projectMode: 'novel-promotion',
}))

const submitTaskMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<SubmitResult>>())
const outboundImageMock = vi.hoisted(() => ({
  sanitizeImageInputsForTaskPayload: vi.fn(),
}))

const sanitizeImageInputs = async (inputs: unknown[]) => ({
  normalized: inputs
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
  issues: [] as Array<{ reason: string }>,
})

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    characterModel: 'img::character',
    locationModel: 'img::location',
    editModel: 'img::edit',
  })),
  buildImageBillingPayloadFromUserConfig: vi.fn((input: { basePayload: Record<string, unknown> }) => ({
    ...input.basePayload,
    generationOptions: { resolution: '1024x1024' },
  })),
  getProjectModelConfig: vi.fn(async () => ({
    characterModel: 'img::character',
    locationModel: 'img::location',
    editModel: 'img::edit',
    storyboardModel: 'img::storyboard',
    analysisModel: 'llm::analysis',
  })),
  buildImageBillingPayload: vi.fn(async (input: { basePayload: Record<string, unknown> }) => ({
    ...input.basePayload,
    generationOptions: { resolution: '1024x1024' },
  })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({
    resolution: '1024x1024',
  })),
}))

const hasOutputMock = vi.hoisted(() => ({
  hasGlobalCharacterOutput: vi.fn(async () => false),
  hasGlobalLocationOutput: vi.fn(async () => false),
  hasGlobalCharacterAppearanceOutput: vi.fn(async () => false),
  hasGlobalLocationImageOutput: vi.fn(async () => false),
  hasCharacterAppearanceOutput: vi.fn(async () => false),
  hasLocationImageOutput: vi.fn(async () => false),
  hasPanelLipSyncOutput: vi.fn(async () => false),
  hasPanelImageOutput: vi.fn(async () => false),
  hasPanelVideoOutput: vi.fn(async () => false),
  hasVoiceLineAudioOutput: vi.fn(async () => false),
}))

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(async () => []),
  },
  userPreference: {
    findUnique: vi.fn(async () => ({ lipSyncModel: 'fal::lipsync-model' })),
  },
  novelPromotionPanel: {
    findFirst: vi.fn(async ({ where }: { where?: { id?: string } } = {}) => {
      const id = where?.id || 'panel-1'
      return {
        id,
        panelIndex: id === 'panel-ins' ? 2 : 1,
        storyboardId: 'storyboard-1',
        storyboard: { id: 'storyboard-1', episodeId: 'episode-1' },
      }
    }),
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async ({ where }: { where?: { id?: string } }) => {
      const id = where?.id || 'panel-1'
      if (id === 'panel-src') {
        return {
          id,
          panelIndex: 1,
          shotType: 'wide',
          cameraMove: 'static',
          description: 'source description',
          videoPrompt: 'source video prompt',
          location: 'source location',
          characters: '[]',
          srtSegment: '',
          duration: 3,
        }
      }
      if (id === 'panel-ins') {
        return {
          id,
          panelIndex: 2,
          shotType: 'medium',
          cameraMove: 'push',
          description: 'insert description',
          videoPrompt: 'insert video prompt',
          location: 'insert location',
          characters: '[]',
          srtSegment: '',
          duration: 3,
        }
      }
      return {
        id,
        panelIndex: 0,
        shotType: 'medium',
        cameraMove: 'static',
        description: 'panel description',
        videoPrompt: 'panel prompt',
        location: 'panel location',
        characters: '[]',
        srtSegment: '',
        duration: 3,
      }
    }),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 'panel-created', panelIndex: 3 })),
  },
  novelPromotionProject: {
    findUnique: vi.fn(async () => ({
      id: 'project-data-1',
      characters: [
        { name: 'Narrator', customVoiceUrl: 'https://voice.example/narrator.mp3' },
      ],
    })),
  },
  novelPromotionStoryboard: {
    findFirst: vi.fn(async () => ({
      id: 'storyboard-1',
      episodeId: 'episode-1',
      clipId: 'clip-1',
    })),
    findUnique: vi.fn(async () => ({ episodeId: 'episode-1' })),
  },
  novelPromotionEpisode: {
    findFirst: vi.fn(async () => ({
      id: 'episode-1',
      speakerVoices: '{}',
      novelPromotionProject: { analysisModel: 'llm::analysis' },
      storyboards: [{ panels: [{ id: 'panel-1' }, { id: 'panel-2' }] }],
    })),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn(async () => [
      { id: 'line-1', speaker: 'Narrator', content: 'hello world voice line' },
    ]),
    findFirst: vi.fn(async () => ({
      id: 'line-1',
      episodeId: 'episode-1',
      speaker: 'Narrator',
      content: 'hello world voice line',
      voicePresetId: 'voice-preset-system',
      emotionPrompt: null,
      emotionStrength: 0.4,
      audioUrl: 'https://voice.example/line-1.mp3',
      episode: {
        speakerVoices: '{}',
        novelPromotionProject: { characters: [] },
      },
    })),
  },
  voicePreset: {
    findFirst: vi.fn(async () => ({
      id: 'voice-preset-system',
      isSystem: true,
      audioUrl: 'voice/system/narrator.wav',
      audioMediaId: null,
      audioMedia: null,
    })),
  },
  $transaction: vi.fn(async (fn: (tx: {
    novelPromotionPanel: {
      findMany: (args: unknown) => Promise<Array<{ id: string; panelIndex: number }>>
      update: (args: unknown) => Promise<unknown>
      create: (args: unknown) => Promise<{ id: string; panelIndex: number }>
    }
  }) => Promise<unknown>) => {
    const tx = {
      novelPromotionPanel: {
        findMany: async () => [],
        update: async () => ({}),
        create: async () => ({ id: 'panel-created', panelIndex: 3 }),
      },
    }
    return await fn(tx)
  }),
}))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireUserAuth: async () => {
      if (!authState.authenticated) return unauthorized()
      return { session: { user: { id: 'user-1' } } }
    },
    requireProjectAuth: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1', mode: authState.projectMode },
      }
    },
    requireProjectAuthLight: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1', mode: authState.projectMode },
      }
    },
  }
})

vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => ({
  resolveAnalysisModel: vi.fn(async () => 'llm::analysis'),
}))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/task/has-output', () => hasOutputMock)
vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ mode: 'default' })),
}))
vi.mock('@/lib/qwen-voice-design', () => ({
  validateVoicePrompt: vi.fn(() => ({ valid: true })),
  validatePreviewText: vi.fn(() => ({ valid: true })),
}))
vi.mock('@/lib/media/outbound-image', () => outboundImageMock)
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/model-pricing/lookup', () => ({
  resolveBuiltinPricing: vi.fn(() => ({ status: 'ok' })),
}))
vi.mock('@/lib/api-config', () => ({
  resolveModelSelection: vi.fn(async () => ({
    model: 'img::storyboard',
  })),
  resolveAtlasCloudSeedAudioConfiguration: vi.fn(async () => ({
    selection: {
      modelId: 'bytedance/seed-audio-1.0',
      modelKey: 'atlascloud::bytedance/seed-audio-1.0',
      provider: 'atlascloud',
      mediaType: 'audio',
    },
    provider: { id: 'atlascloud', name: 'AtlasCloud', apiKey: 'atlas-key' },
  })),
  getProviderKey: vi.fn((provider: string) => provider.split(':')[0]),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

function toApiPath(routeFile: string): string {
  return routeFile
    .replace(/^src\/app/, '')
    .replace(/\/route\.ts$/, '')
    .replace('[projectId]', 'project-1')
    .replace('[episodeId]', 'episode-1')
}

function toModuleImportPath(routeFile: string): string {
  return `@/${routeFile.replace(/^src\//, '').replace(/\.ts$/, '')}`
}

const DIRECT_CASES: ReadonlyArray<DirectRouteCase> = [
  {
    routeFile: 'src/app/api/asset-hub/generate-image/route.ts',
    body: { type: 'character', id: 'global-character-1', appearanceIndex: 0 },
    expectedTaskType: TASK_TYPE.ASSET_HUB_IMAGE,
    expectedTargetType: 'GlobalCharacter',
    expectedProjectId: 'global-asset-hub',
  },
  {
    routeFile: 'src/app/api/asset-hub/modify-image/route.ts',
    body: {
      type: 'character',
      id: 'global-character-1',
      modifyPrompt: 'sharpen details',
      appearanceIndex: 0,
      imageIndex: 0,
      extraImageUrls: ['https://example.com/ref-a.png'],
    },
    expectedTaskType: TASK_TYPE.ASSET_HUB_MODIFY,
    expectedTargetType: 'GlobalCharacterAppearance',
    expectedProjectId: 'global-asset-hub',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/auto-group-multi-shot/route.ts',
    body: {},
    params: { projectId: 'project-1', episodeId: 'episode-1' },
    expectedTaskType: TASK_TYPE.AUTO_GROUP_MULTI_SHOT,
    expectedTargetType: 'NovelPromotionEpisode',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/generate-image/route.ts',
    body: { type: 'character', id: 'character-1', appearanceId: 'appearance-1' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.IMAGE_CHARACTER,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
    body: { videoModel: 'fal::video-model', storyboardId: 'storyboard-1', panelIndex: 0 },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.VIDEO_PANEL,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/insert-panel/route.ts',
    body: { storyboardId: 'storyboard-1', insertAfterPanelId: 'panel-ins' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.INSERT_PANEL,
    expectedTargetType: 'NovelPromotionStoryboard',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/lip-sync/route.ts',
    body: {
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      voiceLineId: 'line-1',
      lipSyncModel: 'fal::lip-model',
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.LIP_SYNC,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts',
    body: {
      type: 'character',
      characterId: 'character-1',
      appearanceId: 'appearance-1',
      modifyPrompt: 'enhance texture',
      extraImageUrls: ['https://example.com/ref-b.png'],
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts',
    body: {
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      modifyPrompt: 'increase contrast',
      extraImageUrls: ['https://example.com/ref-c.png'],
      selectedAssets: [{ imageUrl: 'https://example.com/ref-d.png' }],
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/panel-variant/route.ts',
    body: {
      storyboardId: 'storyboard-1',
      insertAfterPanelId: 'panel-ins',
      sourcePanelId: 'panel-src',
      variant: { video_prompt: 'new prompt', description: 'variant desc' },
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.PANEL_VARIANT,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/regenerate-group/route.ts',
    body: { type: 'character', id: 'character-1', appearanceId: 'appearance-1' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.REGENERATE_GROUP,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/regenerate-panel-image/route.ts',
    body: { panelId: 'panel-1', count: 1 },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.IMAGE_PANEL,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/regenerate-single-image/route.ts',
    body: { type: 'character', id: 'character-1', appearanceId: 'appearance-1', imageIndex: 0 },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.IMAGE_CHARACTER,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/regenerate-storyboard-text/route.ts',
    body: { storyboardId: 'storyboard-1' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.REGENERATE_STORYBOARD_TEXT,
    expectedTargetType: 'NovelPromotionStoryboard',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/voice-design/route.ts',
    body: { voicePrompt: 'warm female voice', previewText: 'This is preview text' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.VOICE_DESIGN,
    expectedTargetType: 'NovelPromotionProject',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/voice-generate/route.ts',
    body: {
      episodeId: 'episode-1',
      lineId: 'line-1',
      audioModel: 'atlascloud::bytedance/seed-audio-1.0',
      clientRequestId: '11111111-1111-4111-8111-111111111111',
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.VOICE_LINE,
    expectedTargetType: 'NovelPromotionVoiceLine',
    expectedProjectId: 'project-1',
  },
]

async function invokePostRoute(routeCase: DirectRouteCase): Promise<Response> {
  const modulePath = toModuleImportPath(routeCase.routeFile)
  const mod = await import(modulePath)
  const post = mod.POST as (request: Request, context?: RouteContext) => Promise<Response>
  const req = buildMockRequest({
    path: toApiPath(routeCase.routeFile),
    method: 'POST',
    body: routeCase.body,
  })
  return await post(req, { params: Promise.resolve(routeCase.params || {}) })
}

describe('api contract - direct submit routes (behavior)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    authState.projectMode = 'novel-promotion'
    let seq = 0
    submitTaskMock.mockImplementation(async () => ({
      taskId: `task-${++seq}`,
      async: true,
    }))
    outboundImageMock.sanitizeImageInputsForTaskPayload.mockImplementation(sanitizeImageInputs)
  })

  it('keeps expected coverage size', () => {
    expect(DIRECT_CASES.length).toBe(16)
  })

  for (const routeCase of DIRECT_CASES) {
    it(`${routeCase.routeFile} -> returns 401 when unauthenticated`, async () => {
      authState.authenticated = false
      const res = await invokePostRoute(routeCase)
      expect(res.status).toBe(401)
      expect(submitTaskMock).not.toHaveBeenCalled()
    })

    it(`${routeCase.routeFile} -> submits task with expected contract when authenticated`, async () => {
      const res = await invokePostRoute(routeCase)
      expect(res.status).toBe(200)
      expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
        type: routeCase.expectedTaskType,
        targetType: routeCase.expectedTargetType,
        projectId: routeCase.expectedProjectId,
        userId: 'user-1',
      }))

      const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
      expect(submitArg?.type).toBe(routeCase.expectedTaskType)
      expect(submitArg?.targetType).toBe(routeCase.expectedTargetType)
      expect(submitArg?.projectId).toBe(routeCase.expectedProjectId)
      expect(submitArg?.userId).toBe('user-1')

      const json = await res.json() as Record<string, unknown>
      const isVoiceGenerateRoute = routeCase.routeFile.endsWith('/voice-generate/route.ts')
      if (isVoiceGenerateRoute) {
        expect(json.success).toBe(true)
        expect(json.async).toBe(true)
        expect(typeof json.taskId).toBe('string')
      } else {
        expect(json.async).toBe(true)
        expect(typeof json.taskId).toBe('string')
      }
    })
  }

  it.each([
    'src/app/api/asset-hub/modify-image/route.ts',
    'src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts',
  ])('%s -> reserved extra image rejects before task submission', async (routeFile) => {
    const routeCase = DIRECT_CASES.find((item) => item.routeFile === routeFile)
    expect(routeCase).toBeDefined()
    const reserved = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`
    outboundImageMock.sanitizeImageInputsForTaskPayload.mockRejectedValueOnce(
      new ApiError('INVALID_PARAMS', { code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN' }),
    )

    const res = await invokePostRoute({
      ...routeCase!,
      body: { ...routeCase!.body, extraImageUrls: [reserved] },
    })
    const responseBody = await res.json()
    expect(res.status).toBe(400)
    expect(responseBody.error.details.code).toBe('VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN')
    expect(outboundImageMock.sanitizeImageInputsForTaskPayload).toHaveBeenCalledWith([reserved])
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('modify-storyboard selected asset -> reserved reference rejects before task submission', async () => {
    const routeCase = DIRECT_CASES.find((item) => (
      item.routeFile === 'src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts'
    ))
    expect(routeCase).toBeDefined()
    const reserved = `https://cos.example/voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav?q-signature=fake`
    outboundImageMock.sanitizeImageInputsForTaskPayload.mockImplementation(async (inputs: unknown[]) => {
      if (inputs.includes(reserved)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN',
        })
      }
      return sanitizeImageInputs(inputs)
    })

    const res = await invokePostRoute({
      ...routeCase!,
      body: {
        ...routeCase!.body,
        extraImageUrls: ['https://example.com/allowed.png'],
        selectedAssets: [{ imageUrl: reserved }],
      },
    })
    const responseBody = await res.json()
    expect(res.status).toBe(400)
    expect(responseBody.error.details.code).toBe('VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN')
    expect(outboundImageMock.sanitizeImageInputsForTaskPayload.mock.calls).toEqual([
      [['https://example.com/allowed.png']],
      [[reserved]],
    ])
    expect(submitTaskMock).not.toHaveBeenCalled()
  })
})
