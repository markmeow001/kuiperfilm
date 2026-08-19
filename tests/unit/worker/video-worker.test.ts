import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>
type WorkerLifecycleOptions = {
  completionClaim?: (input: {
    taskId: string
    result: Record<string, unknown> | null
    billing?: { billingInfo?: unknown; billedAt?: Date | null }
  }) => Promise<boolean>
  terminalReconcile?: () => Promise<unknown>
}

type PanelRow = {
  id: string
  storyboardId: string
  panelIndex: number
  videoUrl: string | null
  imageUrl: string | null
  videoPrompt: string | null
  description: string | null
  firstLastFramePrompt: string | null
  srtSegment: string | null
  storyboard: { id: string; episodeId: string }
}

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
}))

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const withTaskLifecycleMock = vi.hoisted(() =>
  vi.fn(async (
    job: Job<TaskJobData>,
    handler: WorkerProcessor,
    _options?: WorkerLifecycleOptions,
  ) => await handler(job)),
)

const episodePackagePublicationMock = vi.hoisted(() => ({
  claimEpisodePackageCompletion: vi.fn(async () => true),
  reconcileEpisodePackageTerminalState: vi.fn(async () => 'deleted'),
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ videoRatio: '16:9' })),
  resolveLipSyncVideoSource: vi.fn(async () => 'https://provider.example/lipsync.mp4'),
  resolveVideoSourceFromGeneration: vi.fn(async (..._args: unknown[]): Promise<{ url: string; downloadHeaders?: Record<string, string> }> => ({ url: 'https://provider.example/video.mp4' })),
  toSignedUrlIfCos: vi.fn((url: string | null) => (url ? `https://signed.example/${url}` : null)),
  uploadVideoSourceToCos: vi.fn(async () => 'cos/lip-sync/video.mp4'),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async (_args?: unknown) => undefined),
  },
  novelPromotionVoiceLine: {
    findUnique: vi.fn(),
  },
}))

const projectScopeMock = vi.hoisted(() => ({
  requireNovelPromotionPanelInProject: vi.fn(),
  requireNovelPromotionVoiceLineInProject: vi.fn(),
  findNovelPromotionPanelByStoryboardIndexInProject: vi.fn(),
  updateNovelPromotionPanelInProject: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) {
      void name
    }

    async add() {
      return { id: 'job-1' }
    }

    async getJob() {
      return null
    }
  },
  Worker: class {
    constructor(name: string, processor: WorkerProcessor) {
      void name
      workerState.processor = processor
    }
  },
}))

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  withTaskLifecycle: withTaskLifecycleMock,
}))
vi.mock('@/lib/novel-promotion/episode-package-publication', () => episodePackagePublicationMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/novel-promotion/project-scope', () => projectScopeMock)
vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: vi.fn(async (input: string) => input),
}))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/model-config-contract', () => ({
  parseModelKeyStrict: vi.fn(() => ({ provider: 'fal' })),
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'api-key' })),
}))

const styleProfileLoaderMock = vi.hoisted(() => ({
  loadStyleProfile: vi.fn(async () => null as null | {
    positivePrompt: string | null
    negativePrompt: string | null
    referenceImageUrls: string[]
  }),
}))

vi.mock('@/lib/style-profile/loader', () => styleProfileLoaderMock)

function buildPanel(overrides?: Partial<PanelRow>): PanelRow {
  return {
    id: 'panel-1',
    storyboardId: 'storyboard-1',
    panelIndex: 0,
    videoUrl: 'cos/base-video.mp4',
    imageUrl: 'cos/panel-image.png',
    videoPrompt: 'panel prompt',
    description: 'panel description',
    firstLastFramePrompt: null,
    srtSegment: null,
    storyboard: { id: 'storyboard-1', episodeId: 'episode-1' },
    ...(overrides || {}),
  }
}

function buildJob(params: {
  type: TaskJobData['type']
  payload?: Record<string, unknown>
  targetType?: string
  targetId?: string
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: params.type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: params.targetType ?? 'NovelPromotionPanel',
      targetId: params.targetId ?? 'panel-1',
      payload: params.payload ?? {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker video processor behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerState.processor = null

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue(buildPanel())
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(buildPanel())
    projectScopeMock.requireNovelPromotionPanelInProject.mockImplementation(async () => {
      const panel = await prismaMock.novelPromotionPanel.findUnique()
      if (!panel) throw new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')
      return panel
    })
    projectScopeMock.findNovelPromotionPanelByStoryboardIndexInProject.mockImplementation(
      async () => await prismaMock.novelPromotionPanel.findFirst(),
    )
    projectScopeMock.updateNovelPromotionPanelInProject.mockImplementation(
      async (_projectId: string, panelId: string, data: Record<string, unknown>) => {
        await prismaMock.novelPromotionPanel.update({ where: { id: panelId }, data })
      },
    )
    prismaMock.novelPromotionVoiceLine.findUnique.mockResolvedValue({
      id: 'line-1',
      episodeId: 'episode-1',
      audioUrl: 'cos/line-1.mp3',
    })
    projectScopeMock.requireNovelPromotionVoiceLineInProject.mockImplementation(async () => {
      const voiceLine = await prismaMock.novelPromotionVoiceLine.findUnique()
      if (!voiceLine) throw new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')
      return voiceLine
    })

    const mod = await import('@/lib/workers/video.worker')
    mod.createVideoWorker()
  })

  it('VIDEO_PANEL: 缺少 payload.videoModel 时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {},
    })

    await expect(processor!(job)).rejects.toThrow('VIDEO_MODEL_REQUIRED: payload.videoModel is required')
  })

  it('VIDEO_PANEL: 透传异步轮询返回的下载头到 COS 上传', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'openai-compatible:oa-1::sora-2',
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://provider.example/video.mp4',
      'panel-video',
      'panel-1',
      {
        Authorization: 'Bearer oa-key',
      },
    )
  })

  it('LIP_SYNC: 缺少 panel 时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(null)
    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: { voiceLineId: 'line-1' },
      targetId: 'panel-missing',
    })

    await expect(processor!(job)).rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')
  })

  it('LIP_SYNC: 正常路径写回 lipSyncVideoUrl 并清理 lipSyncTaskId', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: {
        voiceLineId: 'line-1',
        lipSyncModel: 'fal::lipsync-model',
      },
      targetId: 'panel-1',
    })

    const result = await processor!(job) as { panelId: string; voiceLineId: string; lipSyncVideoUrl: string }
    expect(result).toEqual({
      panelId: 'panel-1',
      voiceLineId: 'line-1',
      lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
    })

    expect(utilsMock.resolveLipSyncVideoSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        modelKey: 'fal::lipsync-model',
      }),
    )

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
        lipSyncTaskId: null,
      },
    })
  })

  it('未知任务类型: 显式报错', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const unsupportedJob = buildJob({
      type: TASK_TYPE.AI_CREATE_CHARACTER,
    })

    await expect(processor!(unsupportedJob)).rejects.toThrow('Unsupported video task type')
  })

  it('EPISODE_STITCH_MP4: wires terminal reconciliation without changing other task handlers', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    withTaskLifecycleMock.mockImplementationOnce(async () => undefined)
    const job = buildJob({
      type: TASK_TYPE.EPISODE_STITCH_MP4,
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      payload: { episodeId: 'episode-1', sourceFingerprint: 'f'.repeat(64) },
    })

    await processor!(job)

    const options = withTaskLifecycleMock.mock.calls.at(-1)?.[2]
    expect(options?.completionClaim).toEqual(expect.any(Function))
    expect(options?.terminalReconcile).toEqual(expect.any(Function))
    await options!.terminalReconcile!()
    expect(episodePackagePublicationMock.reconcileEpisodePackageTerminalState).toHaveBeenCalledWith(job)
  })

  // Bug-4 chokepoint approach: video handler 把 raw prompt + raw styleProfile 透传给
  // resolveVideoSourceFromGeneration (chokepoint)，chokepoint 內做 inject。
  it('VIDEO_PANEL: project 有 styleProfile -> resolveVideoSourceFromGeneration 收到原 styleProfile 透传 + options.prompt 是 raw', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const styleProfileFixture = {
      positivePrompt: 'VIDEO_STYLE_POS',
      negativePrompt: 'VIDEO_STYLE_NEG',
      referenceImageUrls: ['https://style/video-ref.png'],
    }
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(styleProfileFixture)

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'fal::seedance-1',
        generationOptions: { duration: 5, resolution: '720p' },
      },
    })

    await processor!(job)

    const calls = utilsMock.resolveVideoSourceFromGeneration.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const generationArg = calls[0]?.[1] as {
      options?: { prompt?: string; referenceImages?: string[]; negativePrompt?: string | null }
      styleProfile?: typeof styleProfileFixture | null
    } | undefined
    expect(generationArg).toBeDefined()
    // styleProfile 必须原封不动透传给 chokepoint
    expect(generationArg?.styleProfile).toEqual(styleProfileFixture)
    // handler 不再自己 prepend — options.prompt 是 raw
    const optionsPrompt = generationArg?.options?.prompt ?? ''
    expect(optionsPrompt.length).toBeGreaterThan(0)
    expect(optionsPrompt).not.toContain('VIDEO_STYLE_POS')
    // handler 不再 inline 注入 negativePrompt — chokepoint 处理
    const neg = generationArg?.options?.negativePrompt ?? null
    expect(neg).toBeNull()
  })

  it('VIDEO_PANEL: project styleProfile 为 null -> resolveVideoSourceFromGeneration 收到 styleProfile = null', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(null)

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'fal::seedance-1',
        generationOptions: { duration: 5, resolution: '720p' },
      },
    })

    await processor!(job)

    const calls = utilsMock.resolveVideoSourceFromGeneration.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const generationArg = calls[0]?.[1] as {
      options?: { prompt?: string; negativePrompt?: string | null }
      styleProfile?: unknown
    } | undefined
    expect(generationArg?.styleProfile).toBeNull()
    const optionsPrompt = generationArg?.options?.prompt ?? ''
    // 实际值必须存在（不是空字串）— 防 trivial pass
    expect(optionsPrompt.length).toBeGreaterThan(0)
    expect(optionsPrompt).not.toMatch(/VIDEO_STYLE_POS|VIDEO_STYLE_NEG/)
    const neg = generationArg?.options?.negativePrompt ?? null
    expect(neg).toBeNull()
  })
})
