import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'

type AuthMode = 'editor' | 'viewer'
type Direction = 'earlier' | 'later'
type PanelRow = {
  id: string
  storyboardId: string
  panelIndex: number
  panelNumber: number | null
  multiShotGroupId: string | null
  multiShotGroupOrder: number | null
  description?: string | null
  characters?: string | null
  location?: string | null
  duration?: number | null
}

const authState = vi.hoisted(() => ({ mode: 'editor' as AuthMode }))

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionStoryboard: { updateMany: vi.fn() },
  novelPromotionPanel: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  },
  novelPromotionVoiceLine: { updateMany: vi.fn() },
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(
    async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
  ),
}))

const taskMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const billingMock = vi.hoisted(() => ({ buildDefaultTaskBillingInfo: vi.fn() }))

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireProjectAuthLight: async (projectId: string) => {
    if (authState.mode === 'viewer') {
      return new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    }
    return {
      session: { user: { id: 'editor-1' } },
      project: { id: projectId, userId: 'owner-1' },
    }
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => taskMock)
vi.mock('@/lib/billing', () => billingMock)

const PROJECT_ID = 'project-1'
const EPISODE_ID = 'episode-1'
const STORYBOARD_A = 'storyboard-a'
const STORYBOARD_B = 'storyboard-b'
const IDEMPOTENCY_KEY = '7e97e328-8d67-49b3-88d3-bcff1d50a11a'

const BASE_PANELS: PanelRow[] = [
  {
    id: 'panel-a0',
    storyboardId: STORYBOARD_A,
    panelIndex: 0,
    panelNumber: 1,
    multiShotGroupId: 'group-a',
    multiShotGroupOrder: 0,
  },
  {
    id: 'panel-a1',
    storyboardId: STORYBOARD_A,
    panelIndex: 1,
    panelNumber: 2,
    multiShotGroupId: 'group-a',
    multiShotGroupOrder: 1,
  },
  {
    id: 'panel-a2',
    storyboardId: STORYBOARD_A,
    panelIndex: 2,
    panelNumber: 3,
    multiShotGroupId: 'group-b',
    multiShotGroupOrder: 0,
  },
  {
    id: 'panel-a3',
    storyboardId: STORYBOARD_A,
    panelIndex: 3,
    panelNumber: 4,
    multiShotGroupId: 'group-b',
    multiShotGroupOrder: 1,
  },
  {
    id: 'panel-b0',
    storyboardId: STORYBOARD_B,
    panelIndex: 0,
    panelNumber: 1,
    multiShotGroupId: 'group-b',
    multiShotGroupOrder: 0,
  },
]

let panels: PanelRow[] = []
let operationLog: string[] = []

function panelOrder(storyboardId: string) {
  return panels
    .filter((panel) => panel.storyboardId === storyboardId)
    .sort((left, right) => left.panelIndex - right.panelIndex)
    .map((panel) => ({
      id: panel.id,
      panelIndex: panel.panelIndex,
      panelNumber: panel.panelNumber,
      multiShotGroupOrder: panel.multiShotGroupOrder,
    }))
}

function installStatefulTransactionMocks() {
  txMock.$queryRaw.mockImplementation(async () => {
    operationLog.push('lock-episode')
    return [{ id: EPISODE_ID }]
  })
  txMock.novelPromotionEpisode.findFirst.mockImplementation(async () => ({
    id: EPISODE_ID,
    novelPromotionProject: { generationMode: 'r2v-narrative' },
  }))
  txMock.novelPromotionPanel.findMany.mockImplementation(async () => (
    panels
      .slice()
      .sort((left, right) => {
        if (left.storyboardId !== right.storyboardId) {
          return left.storyboardId.localeCompare(right.storyboardId)
        }
        return left.panelIndex - right.panelIndex
      })
  ))
  txMock.novelPromotionPanel.createMany.mockImplementation(async ({
    data,
    skipDuplicates,
  }: {
    data: PanelRow[]
    skipDuplicates: boolean
  }) => {
    operationLog.push('create-panel')
    expect(skipDuplicates).toBe(true)
    const row = data[0]
    if (panels.some((panel) => panel.id === row.id)) return { count: 0 }
    panels.push(structuredClone(row))
    return { count: 1 }
  })
  txMock.novelPromotionPanel.deleteMany.mockImplementation(async ({ where }: { where: { id: string } }) => {
    operationLog.push('delete-panel')
    const before = panels.length
    panels = panels.filter((panel) => panel.id !== where.id)
    return { count: before - panels.length }
  })
  txMock.novelPromotionPanel.updateMany.mockImplementation(async ({ where, data }: {
    where: { id?: string; storyboardId?: string; panelIndex?: { gte?: number } }
    data: {
      panelIndex?: number | { increment?: number; decrement?: number }
      panelNumber?: number | { increment?: number; decrement?: number }
      multiShotGroupOrder?: number | null
    }
  }) => {
    operationLog.push(where.id ? `write:${where.id}` : 'park-indexes')
    let count = 0
    for (const panel of panels) {
      const matchesId = where.id === undefined || panel.id === where.id
      const matchesStoryboard = where.storyboardId === undefined || panel.storyboardId === where.storyboardId
      const matchesIndex = where.panelIndex?.gte === undefined || panel.panelIndex >= where.panelIndex.gte
      if (!matchesId || !matchesStoryboard || !matchesIndex) continue
      count += 1
      for (const field of ['panelIndex', 'panelNumber'] as const) {
        const next = data[field]
        if (typeof next === 'number') panel[field] = next
        else if (next?.increment) panel[field] = (panel[field] ?? 0) + next.increment
        else if (next?.decrement) panel[field] = (panel[field] ?? 0) - next.decrement
      }
      if ('multiShotGroupOrder' in data) panel.multiShotGroupOrder = data.multiShotGroupOrder ?? null
    }
    return { count }
  })
  txMock.novelPromotionStoryboard.updateMany.mockImplementation(async () => ({ count: 1 }))
  txMock.novelPromotionVoiceLine.updateMany.mockImplementation(async () => ({ count: 0 }))
}

async function invoke(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
  const route = await import(
    '@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/panels/route'
  )
  return callRoute(route[method] as never, {
    path: `/api/novel-promotion/${PROJECT_ID}/episodes/${EPISODE_ID}/panels`,
    method,
    body,
    context: {
      params: Promise.resolve({ projectId: PROJECT_ID, episodeId: EPISODE_ID }),
    } as never,
  })
}

function manualPanelBody(position: 'before' | 'after', anchorPanelId = 'panel-a1') {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    anchorPanelId,
    position,
    panel: {
      description: '手動補鏡',
      characterNames: ['林真'],
      locationName: '天台',
      durationSeconds: 5,
    },
  }
}

describe('episode-scoped storyboard panel edit order', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    authState.mode = 'editor'
    panels = structuredClone(BASE_PANELS)
    operationLog = []
    installStatefulTransactionMocks()
  })

  it('[insert before 選中鏡頭] -> [同 storyboard 精確順序連續且零 AI/task/billing]', async () => {
    const response = await invoke('POST', manualPanelBody('before'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      replayed: false,
      panel: { storyboardId: STORYBOARD_A, panelIndex: 1, panelNumber: 2 },
    })
    const createdPanelId = body.panel.id as string
    expect(panelOrder(STORYBOARD_A)).toEqual([
      { id: 'panel-a0', panelIndex: 0, panelNumber: 1, multiShotGroupOrder: 0 },
      { id: createdPanelId, panelIndex: 1, panelNumber: 2, multiShotGroupOrder: 1 },
      { id: 'panel-a1', panelIndex: 2, panelNumber: 3, multiShotGroupOrder: 2 },
      { id: 'panel-a2', panelIndex: 3, panelNumber: 4, multiShotGroupOrder: 0 },
      { id: 'panel-a3', panelIndex: 4, panelNumber: 5, multiShotGroupOrder: 1 },
    ])
    expect(panelOrder(STORYBOARD_B)).toEqual([
      { id: 'panel-b0', panelIndex: 0, panelNumber: 1, multiShotGroupOrder: 0 },
    ])
    expect(operationLog[0]).toBe('lock-episode')
    expect(operationLog.indexOf('park-indexes')).toBeLessThan(operationLog.indexOf('create-panel'))
    expect(taskMock.submitTask).not.toHaveBeenCalled()
    expect(billingMock.buildDefaultTaskBillingInfo).not.toHaveBeenCalled()
  })

  it('[insert after 選中鏡頭] -> [新鏡精確位於 anchor 後且 group order 同步]', async () => {
    const response = await invoke('POST', manualPanelBody('after'))

    expect(response.status).toBe(200)
    const createdPanelId = (await response.json()).panel.id as string
    expect(panelOrder(STORYBOARD_A)).toEqual([
      { id: 'panel-a0', panelIndex: 0, panelNumber: 1, multiShotGroupOrder: 0 },
      { id: 'panel-a1', panelIndex: 1, panelNumber: 2, multiShotGroupOrder: 1 },
      { id: createdPanelId, panelIndex: 2, panelNumber: 3, multiShotGroupOrder: 2 },
      { id: 'panel-a2', panelIndex: 3, panelNumber: 4, multiShotGroupOrder: 0 },
      { id: 'panel-a3', panelIndex: 4, panelNumber: 5, multiShotGroupOrder: 1 },
    ])
  })

  it('[response 遺失後以相同 key/anchor/position/draft 重試] -> [回原 panel 且不再次 park/reorder]', async () => {
    const first = await invoke('POST', manualPanelBody('before'))
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    const writeCountAfterFirst = txMock.novelPromotionPanel.updateMany.mock.calls.length
    const panelCountAfterFirst = panels.length

    const replay = await invoke('POST', manualPanelBody('before'))

    expect(replay.status).toBe(200)
    const replayBody = await replay.json()
    expect(replayBody).toMatchObject({
      success: true,
      replayed: true,
      panel: { id: firstBody.panel.id, storyboardId: STORYBOARD_A, panelIndex: 1 },
    })
    expect(panels).toHaveLength(panelCountAfterFirst)
    expect(operationLog.filter((operation) => operation === 'park-indexes')).toHaveLength(1)
    expect(operationLog.filter((operation) => operation === 'create-panel')).toHaveLength(1)
    expect(txMock.novelPromotionPanel.updateMany).toHaveBeenCalledTimes(writeCountAfterFirst)
  })

  it.each([
    ['draft', { panel: { ...manualPanelBody('before').panel, description: '不同草稿' } }],
    ['anchor', { anchorPanelId: 'panel-a2' }],
    ['position', { position: 'after' }],
  ] as const)(
    '[相同 key 改變 %s] -> [409 且既有 panel/順序不被覆寫]',
    async (_changedField, changed) => {
      expect((await invoke('POST', manualPanelBody('before'))).status).toBe(200)
      const orderBeforeConflict = panelOrder(STORYBOARD_A)
      const writesBeforeConflict = txMock.novelPromotionPanel.updateMany.mock.calls.length

      const conflict = await invoke('POST', {
        ...manualPanelBody('before'),
        ...changed,
      })

      expect(conflict.status).toBe(409)
      expect((await conflict.json()).code).toBe('MANUAL_PANEL_INSERT_IDEMPOTENCY_CONFLICT')
      expect(panelOrder(STORYBOARD_A)).toEqual(orderBeforeConflict)
      expect(txMock.novelPromotionPanel.updateMany).toHaveBeenCalledTimes(writesBeforeConflict)
      expect(operationLog.filter((operation) => operation === 'create-panel')).toHaveLength(1)
    },
  )

  it('[insert 缺少有效 UUID key] -> [400 且 transaction/寫入皆為零]', async () => {
    const response = await invoke('POST', {
      ...manualPanelBody('before'),
      idempotencyKey: 'not-a-uuid',
    })

    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(txMock.novelPromotionPanel.createMany).not.toHaveBeenCalled()
  })

  it.each([
    ['earlier', 'panel-a1', ['panel-a1', 'panel-a0', 'panel-a2', 'panel-a3']],
    ['later', 'panel-a1', ['panel-a0', 'panel-a2', 'panel-a1', 'panel-a3']],
  ] as const)(
    '[move %s 中間鏡頭] -> [只交換相鄰 panel 並保持 contiguous]',
    async (direction: Direction, panelId: string, expectedIds: readonly string[]) => {
      const response = await invoke('PATCH', { panelId, direction })

      expect(response.status).toBe(200)
      expect(panelOrder(STORYBOARD_A).map((panel) => panel.id)).toEqual(expectedIds)
      expect(panelOrder(STORYBOARD_A).map((panel) => panel.panelIndex)).toEqual([0, 1, 2, 3])
      expect(panelOrder(STORYBOARD_A).map((panel) => panel.panelNumber)).toEqual([1, 2, 3, 4])
      const groupA = panels
        .filter((panel) => panel.storyboardId === STORYBOARD_A && panel.multiShotGroupId === 'group-a')
        .sort((left, right) => left.panelIndex - right.panelIndex)
      const groupB = panels
        .filter((panel) => panel.storyboardId === STORYBOARD_A && panel.multiShotGroupId === 'group-b')
        .sort((left, right) => left.panelIndex - right.panelIndex)
      expect(groupA.map((panel) => panel.multiShotGroupOrder)).toEqual([0, 1])
      expect(groupB.map((panel) => panel.multiShotGroupOrder)).toEqual([0, 1])
    },
  )

  it.each([
    ['earlier', 'panel-a0'],
    ['later', 'panel-a3'],
  ] as const)('[move %s 越過 first/last] -> [409 且順序零變更]', async (direction, panelId) => {
    const response = await invoke('PATCH', { panelId, direction })

    expect(response.status).toBe(409)
    expect(panelOrder(STORYBOARD_A).map((panel) => panel.id)).toEqual([
      'panel-a0',
      'panel-a1',
      'panel-a2',
      'panel-a3',
    ])
    expect(txMock.novelPromotionPanel.updateMany).not.toHaveBeenCalled()
  })

  it('[delete 中間鏡頭] -> [deleteMany count=1 後其餘 index/group/voice 精確壓縮]', async () => {
    const response = await invoke('DELETE', { panelId: 'panel-a1' })

    expect(response.status).toBe(200)
    expect(panelOrder(STORYBOARD_A)).toEqual([
      { id: 'panel-a0', panelIndex: 0, panelNumber: 1, multiShotGroupOrder: 0 },
      { id: 'panel-a2', panelIndex: 1, panelNumber: 2, multiShotGroupOrder: 0 },
      { id: 'panel-a3', panelIndex: 2, panelNumber: 3, multiShotGroupOrder: 1 },
    ])
    expect(txMock.novelPromotionPanel.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'panel-a1',
        storyboardId: STORYBOARD_A,
        storyboard: {
          episodeId: EPISODE_ID,
          episode: { novelPromotionProject: { projectId: PROJECT_ID } },
        },
      },
    })
    expect(txMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith({
      where: {
        episodeId: EPISODE_ID,
        matchedPanelId: 'panel-a1',
      },
      data: {
        matchedPanelId: null,
        matchedStoryboardId: null,
        matchedPanelIndex: null,
      },
    })
    expect(txMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith({
      where: {
        episodeId: EPISODE_ID,
        matchedPanelId: 'panel-a2',
      },
      data: {
        matchedStoryboardId: STORYBOARD_A,
        matchedPanelIndex: 1,
      },
    })
  })

  it('[viewer 呼叫 insert/move/delete] -> [403 且交易、task、billing 全為零]', async () => {
    authState.mode = 'viewer'

    const responses = await Promise.all([
      invoke('POST', manualPanelBody('before')),
      invoke('PATCH', { panelId: 'panel-a1', direction: 'earlier' }),
      invoke('DELETE', { panelId: 'panel-a1' }),
    ])

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403])
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(taskMock.submitTask).not.toHaveBeenCalled()
    expect(billingMock.buildDefaultTaskBillingInfo).not.toHaveBeenCalled()
  })

  it('[foreign anchor/panel 或 episode ownership 在 lock 後消失] -> [404 且零寫入]', async () => {
    const foreignInsert = await invoke('POST', manualPanelBody('before', 'foreign-panel'))
    expect(foreignInsert.status).toBe(404)
    expect(txMock.novelPromotionPanel.createMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    operationLog = []
    installStatefulTransactionMocks()
    txMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const drifted = await invoke('DELETE', { panelId: 'panel-a1' })
    expect(drifted.status).toBe(404)
    expect(txMock.novelPromotionPanel.deleteMany).not.toHaveBeenCalled()
    expect(txMock.novelPromotionPanel.updateMany).not.toHaveBeenCalled()
  })

  it('[delete ownership 在 findMany 後漂移] -> [deleteMany count=0 觸發 rollback error 且不 renumber]', async () => {
    txMock.novelPromotionPanel.deleteMany.mockResolvedValueOnce({ count: 0 })

    const response = await invoke('DELETE', { panelId: 'panel-a1' })

    expect(response.status).toBe(404)
    expect(txMock.novelPromotionPanel.updateMany).not.toHaveBeenCalled()
    expect(txMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith({
      where: { episodeId: EPISODE_ID, matchedPanelId: 'panel-a1' },
      data: {
        matchedPanelId: null,
        matchedStoryboardId: null,
        matchedPanelIndex: null,
      },
    })
    expect(txMock.novelPromotionStoryboard.updateMany).not.toHaveBeenCalled()
  })

  it('[storyboard panelCount update 在 transaction 內 count=0] -> [fail closed 不回假成功]', async () => {
    txMock.novelPromotionStoryboard.updateMany.mockResolvedValueOnce({ count: 0 })

    const response = await invoke('PATCH', { panelId: 'panel-a1', direction: 'earlier' })

    expect(response.status).toBe(404)
  })
})
