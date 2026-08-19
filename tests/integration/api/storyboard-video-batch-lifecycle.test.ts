import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'

type PanelRow = {
  id: string
  imageUrl: string | null
  imageMediaId: string | null
  videoUrl: string | null
  videoMediaId: string | null
  description: string | null
  videoPrompt: string | null
  firstLastFramePrompt: string | null
  srtSegment: string | null
  updatedAt: Date
}

const submitTaskMock = vi.hoisted(() => vi.fn())
const hasPanelVideoOutputMock = vi.hoisted(() => vi.fn(async () => false))
const billingCost = vi.hoisted<{ value: number | null }>(() => ({ value: 2.5 }))
const buildBillingMock = vi.hoisted(() => vi.fn(() => ({
  billable: true,
  source: 'task',
  taskType: 'video_panel',
  apiType: 'video',
  model: 'fal::video-model',
  quantity: 1,
  unit: 'video',
  maxFrozenCost: billingCost.value,
  action: 'video_panel',
  status: 'quoted',
})))
const panelRows = vi.hoisted<{ value: PanelRow[] }>(() => ({
  value: [
    makePanel('panel-1', 'https://media.test/1.jpg'),
    makePanel('panel-2', 'https://media.test/2.jpg'),
  ],
}))
const activeTaskRows = vi.hoisted<{ value: Array<{ id: string; targetId: string; status: string; payload?: unknown }> }>(() => ({
  value: [],
}))
const replayTaskRows = vi.hoisted<{ value: Array<{ id: string; targetId: string; status: string; payload?: unknown }> }>(() => ({
  value: [],
}))
const dedupedTaskRows = vi.hoisted<{ value: Array<{ id: string; targetId: string; status: string; payload?: unknown }> }>(() => ({
  value: [],
}))
const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findMany: vi.fn(async () => panelRows.value),
  },
  task: {
    findMany: vi.fn(async (args: { where?: { payload?: unknown } }) => (
      args?.where?.payload ? replayTaskRows.value : activeTaskRows.value
    )),
    findFirst: vi.fn(async (args: { where?: { id?: string } }) => (
      dedupedTaskRows.value.find((task) => task.id === args?.where?.id) ?? null
    )),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1', mode: 'novel-promotion' },
  })),
}))
vi.mock('@/lib/novel-promotion/project-scope', () => ({
  findNovelPromotionEpisodeInProject: vi.fn(async (_projectId: string, episodeId: string) => ({ id: episodeId })),
  findNovelPromotionPanelByStoryboardIndexInProject: vi.fn(async () => null),
  requireNovelPromotionPanelInProject: vi.fn(async (_projectId: string, panelId: string) => ({
    ...panelRows.value.find((panel) => panel.id === panelId),
    storyboard: { episodeId: 'episode-1' },
  })),
}))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/has-output', () => ({ hasPanelVideoOutput: hasPanelVideoOutputMock }))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: buildBillingMock,
  BILLING_CURRENCY: 'CNY',
}))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => null),
}))
vi.mock('@/lib/model-pricing/lookup', () => ({
  resolveBuiltinPricing: vi.fn(() => ({ status: 'ok' })),
}))
vi.mock('@/lib/config-service', () => ({
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({})),
}))

const PROJECT_ID = 'project-1'
const EPISODE_ID = 'episode-1'
const VIDEO_MODEL = 'fal::video-model'

function makePanel(
  id: string,
  imageUrl: string | null,
  overrides: Partial<PanelRow> = {},
): PanelRow {
  return {
    id,
    imageUrl,
    imageMediaId: null,
    videoUrl: null,
    videoMediaId: null,
    description: `description-${id}`,
    videoPrompt: `prompt-${id}`,
    firstLastFramePrompt: null,
    srtSegment: null,
    updatedAt: new Date('2026-08-10T10:00:00.000Z'),
    ...overrides,
  }
}

async function post(body: Record<string, unknown>, projectId = PROJECT_ID) {
  const route = await import('@/app/api/novel-promotion/[projectId]/generate-video/route')
  return await callRoute(route.POST as never, {
    path: `/api/novel-promotion/${projectId}/generate-video`,
    method: 'POST',
    body,
    context: { params: Promise.resolve({ projectId }) } as never,
  })
}

async function quote() {
  const response = await post({
    all: true,
    intent: 'estimate',
    episodeId: EPISODE_ID,
    videoModel: VIDEO_MODEL,
  })
  return {
    response,
    body: await response.json() as {
      batchRunId: string
      quoteFingerprint: string
      total: number
      newTasks: number
      alreadyActive: number
      skipped: number
      skippedMissingImage: number
      skippedHasVideo: number
      estimatedTotalCost: number | null
      targets: Array<{
        panelId: string
        disposition: 'new' | 'already_active'
        taskId: string | null
        status: string | null
      }>
    },
  }
}

describe('Storyboard batch video quote and settled submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.API_ENCRYPTION_KEY = 'test-only-storyboard-batch-video-signing-secret'
    billingCost.value = 2.5
    panelRows.value = [
      makePanel('panel-1', 'https://media.test/1.jpg'),
      makePanel('panel-2', 'https://media.test/2.jpg'),
    ]
    activeTaskRows.value = []
    replayTaskRows.value = []
    dedupedTaskRows.value = []
    submitTaskMock.mockResolvedValue({
      success: true,
      async: true,
      taskId: 'task-default',
      status: 'queued',
      deduped: false,
    })
  })

  it('estimate 2 個 panel -> 回精確目標與最高總費用，建立 0 個 task', async () => {
    const { response, body } = await quote()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      kind: 'quote',
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
      currency: 'CNY',
      estimatedCostPerTask: 2.5,
      estimatedTotalCost: 5,
      targets: [{ panelId: 'panel-1' }, { panelId: 'panel-2' }],
      total: 2,
      newTasks: 2,
      alreadyActive: 0,
      skipped: 0,
    })
    expect(body.quoteFingerprint).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(submitTaskMock).not.toHaveBeenCalled()
    expect(hasPanelVideoOutputMock).not.toHaveBeenCalled()
  })

  it('all:true 沒有明確 intent 時拒絕，legacy 不可直接建立 task', async () => {
    const response = await post({
      all: true,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })

    expect(response.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('有新任務但 server 無法取得可靠最高費用時 fail closed', async () => {
    billingCost.value = null

    const response = await post({
      all: true,
      intent: 'estimate',
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(JSON.stringify(payload)).toContain('QUOTE_PRICE_UNAVAILABLE')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('videoMediaId-only 已有輸出 -> 算 skippedHasVideo 且不建立 task', async () => {
    panelRows.value = [
      makePanel('panel-media-only', 'https://media.test/media-only.jpg', {
        videoMediaId: 'media-video-1',
      }),
    ]

    const { response, body } = await quote()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      total: 0,
      newTasks: 0,
      alreadyActive: 0,
      skipped: 1,
      skippedMissingImage: 0,
      skippedHasVideo: 1,
      estimatedTotalCost: 0,
    })
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('forged 或 cross-project quote 都拒絕，建立 0 個 task', async () => {
    const { body } = await quote()
    const forged = `${body.quoteFingerprint.slice(0, -1)}${body.quoteFingerprint.endsWith('a') ? 'b' : 'a'}`
    const forgedResponse = await post({
      all: true,
      intent: 'submit',
      batchRunId: body.batchRunId,
      quoteFingerprint: forged,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    const crossProjectResponse = await post({
      all: true,
      intent: 'submit',
      batchRunId: body.batchRunId,
      quoteFingerprint: body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    }, 'project-2')

    expect(forgedResponse.status).toBe(409)
    expect(crossProjectResponse.status).toBe(409)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('pricing 或 panel source/output 在報價後改變時拒絕 submit', async () => {
    const priced = await quote()
    billingCost.value = 3
    const priceResponse = await post({
      all: true,
      intent: 'submit',
      batchRunId: priced.body.batchRunId,
      quoteFingerprint: priced.body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    expect(priceResponse.status).toBe(409)

    billingCost.value = 2.5
    const sourced = await quote()
    panelRows.value = panelRows.value.map((panel) => panel.id === 'panel-1'
      ? { ...panel, updatedAt: new Date('2026-08-10T10:02:00.000Z') }
      : panel)
    const sourceResponse = await post({
      all: true,
      intent: 'submit',
      batchRunId: sourced.body.batchRunId,
      quoteFingerprint: sourced.body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    expect(sourceResponse.status).toBe(409)

    panelRows.value = panelRows.value.map((panel) => panel.id === 'panel-1'
      ? { ...panel, videoUrl: 'https://media.test/raced.mp4' }
      : panel)
    const outputResponse = await post({
      all: true,
      intent: 'submit',
      batchRunId: sourced.body.batchRunId,
      quoteFingerprint: sourced.body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    expect(outputResponse.status).toBe(409)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('different active model/options/source identity 回 conflict，不假 dedupe', async () => {
    activeTaskRows.value = [{
      id: 'task-other-model',
      targetId: 'panel-1',
      status: 'processing',
      payload: {
        videoModel: 'fal::another-model',
        generationOptions: {},
        panelSourceSnapshot: {
          ...makePanel('panel-1', 'https://media.test/1.jpg'),
          updatedAt: '2026-08-10T10:00:00.000Z',
        },
      },
    }]

    const response = await post({
      all: true,
      intent: 'estimate',
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })

    expect(response.status).toBe(409)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('terminal replay with same batchRunId 回原 task，建立 0 個新 task', async () => {
    const { body } = await quote()
    replayTaskRows.value = [
      { id: 'task-original-1', targetId: 'panel-1', status: 'completed', payload: { batchRunId: body.batchRunId } },
      { id: 'task-original-2', targetId: 'panel-2', status: 'failed', payload: { batchRunId: body.batchRunId } },
    ]

    const response = await post({
      all: true,
      intent: 'submit',
      batchRunId: body.batchRunId,
      quoteFingerprint: body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.items).toEqual([
      expect.objectContaining({ panelId: 'panel-1', taskId: 'task-original-1' }),
      expect.objectContaining({ panelId: 'panel-2', taskId: 'task-original-2' }),
    ])
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('quote 後目標改變 -> submit 回 409 QUOTE_STALE 且不建立 task', async () => {
    const { body } = await quote()
    panelRows.value = [
      makePanel('panel-1', 'https://media.test/1.jpg'),
      makePanel('panel-2', 'https://media.test/2.jpg'),
      makePanel('panel-3', 'https://media.test/3.jpg'),
    ]

    const response = await post({
      all: true,
      intent: 'submit',
      batchRunId: body.batchRunId,
      quoteFingerprint: body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(JSON.stringify(payload)).toContain('QUOTE_STALE')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('一個 task submit 失敗 -> HTTP 200 partial 且逐 panel 回 accepted/rejected', async () => {
    const { body } = await quote()
    submitTaskMock
      .mockResolvedValueOnce({
        success: true,
        async: true,
        taskId: 'task-1',
        status: 'queued',
        deduped: false,
      })
      .mockRejectedValueOnce(Object.assign(new Error('queue unavailable'), { code: 'QUEUE_DOWN' }))

    const response = await post({
      all: true,
      intent: 'submit',
      batchRunId: body.batchRunId,
      quoteFingerprint: body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      kind: 'submission',
      batchRunId: body.batchRunId,
      quoteFingerprint: body.quoteFingerprint,
      total: 2,
      accepted: 1,
      deduped: 0,
      rejected: 1,
      outcome: 'partial',
      items: [
        {
          panelId: 'panel-1',
          outcome: 'accepted',
          taskId: 'task-1',
          status: 'queued',
          error: null,
        },
        {
          panelId: 'panel-2',
          outcome: 'rejected',
          taskId: null,
          status: null,
          error: { code: 'QUEUE_DOWN', message: 'queue unavailable' },
        },
      ],
    })
    expect(submitTaskMock.mock.calls[0]?.[0]).toMatchObject({
      targetId: 'panel-1',
      dedupeKey: 'video_panel:panel-1',
      billingInfo: { maxFrozenCost: 2.5 },
    })
    expect(submitTaskMock.mock.calls[1]?.[0]).toMatchObject({
      targetId: 'panel-2',
      dedupeKey: 'video_panel:panel-2',
      billingInfo: { maxFrozenCost: 2.5 },
    })
  })

  it('active task deduped -> 逐項標記 deduped，不誤算成新 accepted', async () => {
    const { body } = await quote()
    dedupedTaskRows.value = body.targets.map((target, index) => ({
      id: index === 0 ? 'task-existing' : 'task-new',
      targetId: target.panelId,
      status: index === 0 ? 'processing' : 'queued',
      payload: {
        videoModel: VIDEO_MODEL,
        panelSourceSnapshot: {
          ...panelRows.value[index],
          updatedAt: panelRows.value[index].updatedAt.toISOString(),
        },
      },
    }))
    submitTaskMock
      .mockResolvedValueOnce({ taskId: 'task-existing', status: 'processing', deduped: true })
      .mockResolvedValueOnce({ taskId: 'task-new', status: 'queued', deduped: false })

    const response = await post({
      all: true,
      intent: 'submit',
      batchRunId: body.batchRunId,
      quoteFingerprint: body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    const payload = await response.json()

    expect(payload).toMatchObject({
      accepted: 1,
      deduped: 1,
      rejected: 0,
      outcome: 'accepted',
      items: [
        { panelId: 'panel-1', outcome: 'deduped', taskId: 'task-existing', status: 'processing' },
        { panelId: 'panel-2', outcome: 'accepted', taskId: 'task-new', status: 'queued' },
      ],
    })
  })

  it('submit dedupe race 若 durable task 是另一 identity -> 拒絕該項而不宣稱 accepted', async () => {
    const { body } = await quote()
    submitTaskMock
      .mockResolvedValueOnce({ taskId: 'task-race', status: 'processing', deduped: true })
      .mockResolvedValueOnce({ taskId: 'task-new', status: 'queued', deduped: false })
    dedupedTaskRows.value = [{
      id: 'task-race',
      targetId: 'panel-1',
      status: 'processing',
      payload: {
        videoModel: 'fal::another-model',
        panelSourceSnapshot: {
          ...panelRows.value[0],
          updatedAt: panelRows.value[0].updatedAt.toISOString(),
        },
      },
    }]

    const response = await post({
      all: true,
      intent: 'submit',
      batchRunId: body.batchRunId,
      quoteFingerprint: body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      accepted: 1,
      deduped: 0,
      rejected: 1,
      outcome: 'partial',
      items: [
        {
          panelId: 'panel-1',
          outcome: 'rejected',
          error: { code: 'ACTIVE_VIDEO_IDENTITY_CONFLICT' },
        },
        { panelId: 'panel-2', outcome: 'accepted', taskId: 'task-new' },
      ],
    })
  })

  it('quote 分開 new/already-active/skipped，submit 只建立 new task 且保留 active task identity', async () => {
    panelRows.value = [
      makePanel('panel-active', 'https://media.test/active.jpg'),
      makePanel('panel-new', 'https://media.test/new.jpg'),
      makePanel('panel-missing-image', null),
      makePanel('panel-complete', 'https://media.test/done.jpg', { videoUrl: 'https://media.test/done.mp4' }),
    ]
    activeTaskRows.value = [
      {
        id: 'task-active',
        targetId: 'panel-active',
        status: 'processing',
        payload: {
          videoModel: VIDEO_MODEL,
          panelSourceSnapshot: {
            updatedAt: '2026-08-10T10:00:00.000Z',
            imageUrl: 'https://media.test/active.jpg',
            imageMediaId: null,
            description: 'description-panel-active',
            videoPrompt: 'prompt-panel-active',
            firstLastFramePrompt: null,
            srtSegment: null,
            videoUrl: null,
            videoMediaId: null,
          },
        },
      },
    ]

    const { body } = await quote()
    expect(body).toMatchObject({
      total: 2,
      newTasks: 1,
      alreadyActive: 1,
      skipped: 2,
      skippedMissingImage: 1,
      skippedHasVideo: 1,
      estimatedTotalCost: 2.5,
    })
    expect(body.targets).toEqual([
      {
        panelId: 'panel-active',
        disposition: 'already_active',
        taskId: 'task-active',
        status: 'processing',
      },
      {
        panelId: 'panel-new',
        disposition: 'new',
        taskId: null,
        status: null,
      },
    ])

    submitTaskMock.mockResolvedValueOnce({
      taskId: 'task-new',
      status: 'queued',
      deduped: false,
    })
    const response = await post({
      all: true,
      intent: 'submit',
      batchRunId: body.batchRunId,
      quoteFingerprint: body.quoteFingerprint,
      episodeId: EPISODE_ID,
      videoModel: VIDEO_MODEL,
    })
    const submission = await response.json()

    expect(submission).toMatchObject({
      total: 2,
      accepted: 1,
      deduped: 1,
      rejected: 0,
      items: [
        { panelId: 'panel-active', outcome: 'deduped', taskId: 'task-active' },
        { panelId: 'panel-new', outcome: 'accepted', taskId: 'task-new' },
      ],
    })
    expect(submitTaskMock).toHaveBeenCalledTimes(1)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'panel-new',
      payload: expect.objectContaining({
        batchRunId: body.batchRunId,
      }),
    }))
  })
})
