import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

type EpisodeRow = {
  id: string
  novelPromotionProjectId: string
  episodeNumber: number
  name: string
  description: string | null
  novelText: string
}

type ProjectRow = {
  id: string
  projectId: string
  lastEpisodeId: string | null
  importStatus: string | null
}

type DatabaseState = {
  episodes: EpisodeRow[]
  project: ProjectRow
}

type DeleteManyArgs = {
  where: { novelPromotionProjectId: string }
}

type FindFirstArgs = {
  where: { novelPromotionProjectId: string }
  orderBy: { episodeNumber: 'desc' }
}

type CreateArgs = {
  data: Omit<EpisodeRow, 'id'>
}

type ProjectUpdateArgs = {
  where: { id: string }
  data: {
    lastEpisodeId?: string | null
    importStatus?: string
  }
}

type SqlQuery = {
  strings: readonly string[]
  values: readonly unknown[]
}

type TransactionClient = {
  $queryRaw: ReturnType<typeof vi.fn>
  novelPromotionEpisode: {
    deleteMany: ReturnType<typeof vi.fn>
    findFirst: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  novelPromotionProject: {
    update: ReturnType<typeof vi.fn>
  }
}

type TransactionCallback = (tx: TransactionClient) => Promise<unknown>

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionEpisode: {
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const PROJECT_ID = 'project-1'
const NOVEL_PROJECT_ID = 'novel-project-1'

let persistedState: DatabaseState
let createAttempt = 0
let failCreateAt: number | null = null
let failProjectUpdate = false
let latestTransactionClient: TransactionClient | null = null
let transactionOperationLog: string[] = []

function initialState(): DatabaseState {
  return {
    episodes: [
      {
        id: 'old-1',
        novelPromotionProjectId: NOVEL_PROJECT_ID,
        episodeNumber: 1,
        name: '舊第一集',
        description: null,
        novelText: '舊文本一',
      },
      {
        id: 'old-2',
        novelPromotionProjectId: NOVEL_PROJECT_ID,
        episodeNumber: 2,
        name: '舊第二集',
        description: null,
        novelText: '舊文本二',
      },
    ],
    project: {
      id: NOVEL_PROJECT_ID,
      projectId: PROJECT_ID,
      lastEpisodeId: 'old-1',
      importStatus: 'ready',
    },
  }
}

function deleteEpisodes(state: DatabaseState, args: DeleteManyArgs) {
  const previousCount = state.episodes.length
  state.episodes = state.episodes.filter(
    (episode) => episode.novelPromotionProjectId !== args.where.novelPromotionProjectId,
  )
  return { count: previousCount - state.episodes.length }
}

function findLastEpisode(state: DatabaseState, args: FindFirstArgs) {
  return state.episodes
    .filter(
      (episode) => episode.novelPromotionProjectId === args.where.novelPromotionProjectId,
    )
    .sort((left, right) => right.episodeNumber - left.episodeNumber)[0] ?? null
}

function createEpisode(state: DatabaseState, args: CreateArgs) {
  createAttempt += 1
  if (failCreateAt === createAttempt) {
    throw new Error('episode create failed')
  }

  const episode: EpisodeRow = {
    id: `new-${createAttempt}`,
    ...args.data,
  }
  state.episodes.push(episode)
  return episode
}

function updateProject(state: DatabaseState, args: ProjectUpdateArgs) {
  if (failProjectUpdate) {
    throw new Error('project update failed')
  }
  if (args.where.id !== state.project.id) {
    throw new Error('project not found')
  }

  state.project = {
    ...state.project,
    ...args.data,
  }
  return state.project
}

function buildTransactionClient(draft: DatabaseState): TransactionClient {
  return {
    $queryRaw: vi.fn(async () => {
      transactionOperationLog.push('lock-project')
      return [{ id: draft.project.id }]
    }),
    novelPromotionEpisode: {
      deleteMany: vi.fn(async (args: DeleteManyArgs) => {
        transactionOperationLog.push('delete-episodes')
        return deleteEpisodes(draft, args)
      }),
      findFirst: vi.fn(async (args: FindFirstArgs) => {
        transactionOperationLog.push('read-max-episode')
        return findLastEpisode(draft, args)
      }),
      create: vi.fn(async (args: CreateArgs) => {
        transactionOperationLog.push('create-episode')
        return createEpisode(draft, args)
      }),
    },
    novelPromotionProject: {
      update: vi.fn(async (args: ProjectUpdateArgs) => {
        transactionOperationLog.push('update-project')
        return updateProject(draft, args)
      }),
    },
  }
}

function getTransactionClient() {
  if (!latestTransactionClient) {
    throw new Error('transaction was not started')
  }
  return latestTransactionClient
}

async function postBatch(body: unknown) {
  const { POST } = await import(
    '@/app/api/novel-promotion/[projectId]/episodes/batch/route'
  )
  return callRoute(POST as never, {
    path: `/api/novel-promotion/${PROJECT_ID}/episodes/batch`,
    method: 'POST',
    body,
    context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')

  persistedState = initialState()
  createAttempt = 0
  failCreateAt = null
  failProjectUpdate = false
  latestTransactionClient = null
  transactionOperationLog = []

  prismaMock.novelPromotionProject.findFirst.mockImplementation(async () => persistedState.project)

  // Root-client mutations model the old, non-atomic implementation. The fixed route must
  // use only the transaction client for every mutation.
  prismaMock.novelPromotionEpisode.deleteMany.mockImplementation(
    async (args: DeleteManyArgs) => deleteEpisodes(persistedState, args),
  )
  prismaMock.novelPromotionEpisode.findFirst.mockImplementation(
    async (args: FindFirstArgs) => findLastEpisode(persistedState, args),
  )
  prismaMock.novelPromotionEpisode.create.mockImplementation(
    async (args: CreateArgs) => createEpisode(persistedState, args),
  )
  prismaMock.novelPromotionProject.update.mockImplementation(
    async (args: ProjectUpdateArgs) => updateProject(persistedState, args),
  )

  prismaMock.$transaction.mockImplementation(
    async (operation: TransactionCallback | Promise<unknown>[]) => {
      if (Array.isArray(operation)) {
        return Promise.all(operation)
      }

      const draft = structuredClone(persistedState)
      const tx = buildTransactionClient(draft)
      latestTransactionClient = tx
      const result = await operation(tx)
      persistedState = draft
      return result
    },
  )
})

describe('POST /episodes/batch atomic replacement', () => {
  it('清空後建立新集 -> 刪除、建立與專案指針在同一 transaction 完成', async () => {
    const response = await postBatch({
      clearExisting: true,
      importStatus: 'completed',
      episodes: [
        { name: '新第一集', description: '描述一', novelText: '新文本一' },
        { name: '新第二集', novelText: '新文本二' },
      ],
    })

    expect(response.status).toBe(200)
    expect(persistedState.episodes).toEqual([
      {
        id: 'new-1',
        novelPromotionProjectId: NOVEL_PROJECT_ID,
        episodeNumber: 1,
        name: '新第一集',
        description: '描述一',
        novelText: '新文本一',
      },
      {
        id: 'new-2',
        novelPromotionProjectId: NOVEL_PROJECT_ID,
        episodeNumber: 2,
        name: '新第二集',
        description: null,
        novelText: '新文本二',
      },
    ])
    expect(persistedState.project).toEqual({
      id: NOVEL_PROJECT_ID,
      projectId: PROJECT_ID,
      lastEpisodeId: 'new-1',
      importStatus: 'completed',
    })

    const tx = getTransactionClient()
    expect(tx.novelPromotionEpisode.deleteMany).toHaveBeenCalledWith({
      where: { novelPromotionProjectId: NOVEL_PROJECT_ID },
    })
    expect(transactionOperationLog).toEqual([
      'lock-project',
      'delete-episodes',
      'create-episode',
      'create-episode',
      'update-project',
    ])

    const lockQuery = tx.$queryRaw.mock.calls[0][0] as SqlQuery
    expect(lockQuery.strings.join('?').replace(/\s+/g, ' ').trim()).toBe(
      'SELECT id FROM novel_promotion_projects WHERE id = ? FOR UPDATE',
    )
    expect(lockQuery.values).toEqual([NOVEL_PROJECT_ID])
    expect(tx.novelPromotionEpisode.create.mock.calls.map(([args]) => args)).toEqual([
      {
        data: {
          novelPromotionProjectId: NOVEL_PROJECT_ID,
          episodeNumber: 1,
          name: '新第一集',
          description: '描述一',
          novelText: '新文本一',
        },
      },
      {
        data: {
          novelPromotionProjectId: NOVEL_PROJECT_ID,
          episodeNumber: 2,
          name: '新第二集',
          description: null,
          novelText: '新文本二',
        },
      },
    ])
    expect(tx.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: NOVEL_PROJECT_ID },
      data: { lastEpisodeId: 'new-1', importStatus: 'completed' },
    })
    expect(prismaMock.novelPromotionEpisode.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.create).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('追加新集 -> 先鎖專案列，再讀取最大集數與建立新集', async () => {
    const response = await postBatch({
      importStatus: 'imported',
      episodes: [{ name: '新第三集', novelText: '新文本三' }],
    })

    expect(response.status).toBe(200)
    expect(persistedState.episodes.at(-1)).toEqual({
      id: 'new-1',
      novelPromotionProjectId: NOVEL_PROJECT_ID,
      episodeNumber: 3,
      name: '新第三集',
      description: null,
      novelText: '新文本三',
    })
    expect(persistedState.project.lastEpisodeId).toBe('new-1')
    expect(persistedState.project.importStatus).toBe('imported')
    expect(transactionOperationLog).toEqual([
      'lock-project',
      'read-max-episode',
      'create-episode',
      'update-project',
    ])
  })

  it('清空後建立第二集失敗 -> transaction 回滾並保留全部舊集', async () => {
    failCreateAt = 2
    const before = structuredClone(persistedState)

    const response = await postBatch({
      clearExisting: true,
      importStatus: 'completed',
      episodes: [
        { name: '新第一集', novelText: '新文本一' },
        { name: '新第二集', novelText: '新文本二' },
      ],
    })

    expect(response.status).toBe(500)
    expect(persistedState).toEqual(before)
    expect(getTransactionClient().novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('更新 lastEpisodeId 失敗 -> transaction 回滾並保留全部舊集', async () => {
    failProjectUpdate = true
    const before = structuredClone(persistedState)

    const response = await postBatch({
      clearExisting: true,
      importStatus: 'completed',
      episodes: [{ name: '新第一集', novelText: '新文本一' }],
    })

    expect(response.status).toBe(500)
    expect(getTransactionClient().novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: NOVEL_PROJECT_ID },
      data: { lastEpisodeId: 'new-1', importStatus: 'completed' },
    })
    expect(persistedState).toEqual(before)
  })

  it('清空且沒有新集 -> 同一 transaction 將 lastEpisodeId 清為 null', async () => {
    const response = await postBatch({
      clearExisting: true,
      episodes: [],
    })

    expect(response.status).toBe(200)
    expect(persistedState.episodes).toEqual([])
    expect(persistedState.project.lastEpisodeId).toBeNull()
    expect(persistedState.project.importStatus).toBe('ready')
    expect(getTransactionClient().novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: NOVEL_PROJECT_ID },
      data: { lastEpisodeId: null },
    })
  })
})

describe('POST /episodes/batch runtime validation', () => {
  const invalidBodies: Array<{ label: string; body: unknown }> = [
    { label: '缺少 episodes', body: {} },
    { label: 'episodes 不是陣列', body: { episodes: null } },
    {
      label: '單次超過 200 集',
      body: {
        episodes: Array.from({ length: 201 }, (_, index) => ({
          name: `第 ${index + 1} 集`,
          novelText: '文本',
        })),
      },
    },
    {
      label: 'clearExisting 不接受字串布林值',
      body: { episodes: [], clearExisting: 'true' },
    },
    {
      label: 'importStatus 只接受 allowlist',
      body: { episodes: [], importStatus: 'empty' },
    },
    { label: '集數項目必須是 object', body: { episodes: [null] } },
    {
      label: '集名不可空白',
      body: { episodes: [{ name: '   ', novelText: '文本' }] },
    },
    {
      label: '集名不可超過 191 字',
      body: { episodes: [{ name: 'a'.repeat(192), novelText: '文本' }] },
    },
    {
      label: 'description 必須是字串',
      body: { episodes: [{ name: '第一集', description: null, novelText: '文本' }] },
    },
    {
      label: 'description 不可超過 MySQL TEXT UTF-8 上限',
      body: {
        episodes: [{ name: '第一集', description: '一'.repeat(21_846), novelText: '文本' }],
      },
    },
    {
      label: 'novelText 為必要字串欄位',
      body: { episodes: [{ name: '第一集' }] },
    },
    {
      label: 'novelText 不可超過 MySQL TEXT UTF-8 上限',
      body: {
        episodes: [{ name: '第一集', novelText: 'a'.repeat(65_536) }],
      },
    },
  ]

  it.each(invalidBodies)('$label -> 400 且不啟動 transaction', async ({ body }) => {
    const before = structuredClone(persistedState)

    const response = await postBatch(body)

    expect(response.status).toBe(400)
    expect(persistedState).toEqual(before)
    expect(prismaMock.novelPromotionProject.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(latestTransactionClient).toBeNull()
  })
})
