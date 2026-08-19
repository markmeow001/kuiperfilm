import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

installAuthMocks()

type StoredRow = Record<string, unknown> & { id: string }

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  novelPromotionClip: {
    create: vi.fn(),
    createMany: vi.fn(),
  },
  novelPromotionStoryboard: {
    create: vi.fn(),
    createMany: vi.fn(),
    findFirst: vi.fn(),
  },
  novelPromotionPanel: {
    create: vi.fn(),
    createMany: vi.fn(),
  },
}))

const taskMock = vi.hoisted(() => ({
  submitTask: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => taskMock)

const fetchMock = vi.fn<typeof fetch>()
const clips = new Map<string, StoredRow>()
const storyboards = new Map<string, StoredRow>()
const panels = new Map<string, StoredRow>()

function installCreateMany(
  mock: ReturnType<typeof vi.fn>,
  store: Map<string, StoredRow>,
) {
  mock.mockImplementation(async ({ data }: { data: StoredRow | StoredRow[] }) => {
    const rows = Array.isArray(data) ? data : [data]
    let count = 0
    for (const row of rows) {
      if (store.has(row.id)) continue
      store.set(row.id, row)
      count += 1
    }
    return { count }
  })
}

function installStoryboardLookup() {
  prismaMock.novelPromotionStoryboard.findFirst.mockImplementation(
    async ({ where }: { where: { id?: string; episodeId?: string } }) => {
      if (!where.id) return null
      const storyboard = storyboards.get(where.id)
      if (!storyboard || storyboard.episodeId !== where.episodeId) return null
      const clip = clips.get(String(storyboard.clipId)) ?? null
      const matchingPanels = [...panels.values()].filter(
        (panel) => panel.storyboardId === storyboard.id,
      )
      return {
        ...storyboard,
        clip,
        panels: matchingPanels,
      }
    },
  )
}

const PROJECT_ID = 'project-1'
const EPISODE_ID = 'episode-1'
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111'
const INITIAL_PANEL = {
  description: '雨夜天台，林真停在霓虹燈下。',
  characterNames: ['林真'],
  locationName: '天台',
  durationSeconds: 10,
}

function invokeManualCreate(initialPanel = INITIAL_PANEL) {
  return import('@/app/api/novel-promotion/[projectId]/storyboard-group/route').then(
    ({ POST }) => callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/storyboard-group`,
      method: 'POST',
      body: {
        episodeId: EPISODE_ID,
        insertIndex: 0,
        idempotencyKey: IDEMPOTENCY_KEY,
        initialPanel,
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    }),
  )
}

describe('manual storyboard group creation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-A')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response('{}', { status: 202 }))
    clips.clear()
    storyboards.clear()
    panels.clear()
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock))
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: EPISODE_ID,
      clips: [],
      novelPromotionProject: { generationMode: 'r2v-narrative' },
    })
    installCreateMany(prismaMock.novelPromotionClip.createMany, clips)
    installCreateMany(prismaMock.novelPromotionStoryboard.createMany, storyboards)
    installCreateMany(prismaMock.novelPromotionPanel.createMany, panels)
    installStoryboardLookup()
  })

  it('[episode 屬於目前 project] -> transaction 精確建立一個真實 panel 且不呼叫 AI/task/regen', async () => {
    const response = await invokeManualCreate()

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: EPISODE_ID,
        novelPromotionProject: { projectId: PROJECT_ID },
      },
      include: {
        clips: { orderBy: { createdAt: 'asc' } },
        novelPromotionProject: { select: { generationMode: true } },
      },
    })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(clips.size).toBe(1)
    expect(storyboards.size).toBe(1)
    expect(panels.size).toBe(1)

    const panel = [...panels.values()][0]
    expect(panel).toMatchObject({
      panelIndex: 0,
      panelNumber: 1,
      shotType: null,
      cameraMove: null,
      description: INITIAL_PANEL.description,
      characters: JSON.stringify(INITIAL_PANEL.characterNames),
      location: INITIAL_PANEL.locationName,
      duration: INITIAL_PANEL.durationSeconds,
      panelGenerationMode: 'r2v_with_subjects',
    })
    expect(panel.description).not.toBe('新镜头描述')
    expect(taskMock.submitTask).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionPanel.create).not.toHaveBeenCalled()
  })

  it('[相同 key 重試相同草稿] -> reconcile 回同一 panel 且不新增第二組', async () => {
    const first = await invokeManualCreate()
    const replay = await invokeManualCreate()

    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    const firstBody = await first.json()
    const replayBody = await replay.json()
    expect(replayBody.panel.id).toBe(firstBody.panel.id)
    expect(replayBody.replayed).toBe(true)
    expect(clips.size).toBe(1)
    expect(storyboards.size).toBe(1)
    expect(panels.size).toBe(1)
    expect(taskMock.submitTask).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[相同 key 改變草稿] -> 409 且既有 panel 不被覆寫', async () => {
    expect((await invokeManualCreate()).status).toBe(200)

    const conflict = await invokeManualCreate({
      ...INITIAL_PANEL,
      description: '另一個不應覆寫原稿的鏡頭',
    })

    expect(conflict.status).toBe(409)
    const body = await conflict.json()
    expect(body.code).toBe('MANUAL_STORYBOARD_IDEMPOTENCY_CONFLICT')
    expect([...panels.values()][0]?.description).toBe(INITIAL_PANEL.description)
    expect(panels.size).toBe(1)
  })

  it('[episode 不屬於目前 project] -> transaction 前 404 且零寫入', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const response = await invokeManualCreate()

    expect(response.status).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(clips.size).toBe(0)
    expect(storyboards.size).toBe(0)
    expect(panels.size).toBe(0)
    expect(taskMock.submitTask).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[episode ownership 在 transaction 前改變] -> 404 且 atomic transaction 零寫入', async () => {
    prismaMock.novelPromotionEpisode.findFirst
      .mockResolvedValueOnce({
        id: EPISODE_ID,
        clips: [],
        novelPromotionProject: { generationMode: 'r2v-narrative' },
      })
      .mockResolvedValueOnce(null)

    const response = await invokeManualCreate()

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledTimes(2)
    expect(clips.size).toBe(0)
    expect(storyboards.size).toBe(0)
    expect(panels.size).toBe(0)
  })

  it('[initialPanel 缺少有效 idempotency key] -> 400 且零寫入', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/storyboard-group/route')
    const response = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/storyboard-group`,
      method: 'POST',
      body: {
        episodeId: EPISODE_ID,
        idempotencyKey: 'not-a-uuid',
        initialPanel: INITIAL_PANEL,
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(panels.size).toBe(0)
  })
})
