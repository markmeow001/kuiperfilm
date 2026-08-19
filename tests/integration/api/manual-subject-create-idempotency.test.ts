import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'
import { deriveManualUploadIds } from '@/lib/novel-promotion/manual-upload-idempotency'

installAuthMocks()

type Row = Record<string, unknown> & { id: string }

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  novelPromotionProject: { findUnique: vi.fn() },
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionCharacter: { create: vi.fn(), createMany: vi.fn(), findUnique: vi.fn() },
  characterAppearance: { create: vi.fn(), upsert: vi.fn() },
  episodeCharacter: { create: vi.fn(), upsert: vi.fn(), findUnique: vi.fn() },
  novelPromotionLocation: { create: vi.fn(), createMany: vi.fn(), findUnique: vi.fn() },
  locationImage: { create: vi.fn(), upsert: vi.fn() },
  episodeLocation: { create: vi.fn(), upsert: vi.fn(), findUnique: vi.fn() },
  novelPromotionProp: { create: vi.fn(), createMany: vi.fn(), findUnique: vi.fn() },
  episodeProp: { create: vi.fn(), upsert: vi.fn(), findUnique: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const fetchMock = vi.fn<typeof fetch>()
const stores = {
  character: new Map<string, Row>(),
  appearance: new Map<string, Row>(),
  episodeCharacter: new Map<string, Row>(),
  location: new Map<string, Row>(),
  locationImage: new Map<string, Row>(),
  episodeLocation: new Map<string, Row>(),
  prop: new Map<string, Row>(),
  episodeProp: new Map<string, Row>(),
}

function installUpsert(
  mock: ReturnType<typeof vi.fn>,
  store: Map<string, Row>,
) {
  mock.mockImplementation(async ({ where, create }: { where: { id: string }; create: Row }) => {
    const existing = store.get(where.id)
    if (existing) return existing
    store.set(where.id, create)
    return create
  })
}

function installCreateMany(
  mock: ReturnType<typeof vi.fn>,
  store: Map<string, Row>,
) {
  mock.mockImplementation(async ({ data }: { data: Row | Row[] }) => {
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

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response('{}', { status: 202 }))
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
  for (const store of Object.values(stores)) store.clear()
  prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock))
  prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'novel-data-id' })
  prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
  installCreateMany(prismaMock.novelPromotionCharacter.createMany, stores.character)
  installUpsert(prismaMock.characterAppearance.upsert, stores.appearance)
  installUpsert(prismaMock.episodeCharacter.upsert, stores.episodeCharacter)
  installCreateMany(prismaMock.novelPromotionLocation.createMany, stores.location)
  installUpsert(prismaMock.locationImage.upsert, stores.locationImage)
  installUpsert(prismaMock.episodeLocation.upsert, stores.episodeLocation)
  installCreateMany(prismaMock.novelPromotionProp.createMany, stores.prop)
  installUpsert(prismaMock.episodeProp.upsert, stores.episodeProp)
  prismaMock.episodeCharacter.findUnique.mockImplementation(async ({ where }) =>
    stores.episodeCharacter.get(where.id) ?? null)
  prismaMock.episodeLocation.findUnique.mockImplementation(async ({ where }) =>
    stores.episodeLocation.get(where.id) ?? null)
  prismaMock.episodeProp.findUnique.mockImplementation(async ({ where }) =>
    stores.episodeProp.get(where.id) ?? null)
  prismaMock.novelPromotionCharacter.findUnique.mockImplementation(async ({ where }) => {
    const character = stores.character.get(where.id)
    if (!character) return null
    return {
      ...character,
      appearances: [...stores.appearance.values()].filter((row) => row.characterId === where.id),
    }
  })
  prismaMock.novelPromotionLocation.findUnique.mockImplementation(async ({ where }) => {
    const location = stores.location.get(where.id)
    if (!location) return null
    return {
      ...location,
      images: [...stores.locationImage.values()].filter((row) => row.locationId === where.id),
    }
  })
  prismaMock.novelPromotionProp.findUnique.mockImplementation(async ({ where }) =>
    stores.prop.get(where.id) ?? null)
})

describe('manual upload create idempotency', () => {
  it('角色同 key replay -> 回同 entity/appearance/binding 且不走 legacy create 或 AI', async () => {
    const key = '11111111-1111-4111-8111-111111111111'
    const ids = deriveManualUploadIds('character', 'novel-data-id', key)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/character/route')
    const invoke = () => callRoute(POST as never, {
      path: '/api/novel-promotion/project-1/character',
      method: 'POST',
      body: {
        name: '林醫師',
        description: '',
        introduction: '冷靜的急診醫師',
        episodeId: 'episode-1',
        idempotencyKey: key,
      },
      context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
    })

    const first = await invoke()
    const replay = await invoke()

    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    for (const response of [first, replay]) {
      const body = await response.json()
      expect(body.character.id).toBe(ids.entityId)
      expect(body.character.introduction).toBe('冷靜的急診醫師')
      expect(body.character.appearances[0].id).toBe(ids.primaryAssetId)
    }
    expect(stores.character.size).toBe(1)
    expect(stores.character.get(ids.entityId)?.introduction).toBe('冷靜的急診醫師')
    expect(stores.appearance.size).toBe(1)
    expect(stores.episodeCharacter.size).toBe(1)
    expect(prismaMock.novelPromotionCharacter.create).not.toHaveBeenCalled()
    expect(prismaMock.characterAppearance.create).not.toHaveBeenCalled()
    expect(prismaMock.episodeCharacter.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('同角色 key 改 body scope -> 409，原 entity 不被覆寫', async () => {
    const key = '22222222-2222-4222-8222-222222222222'
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/character/route')
    const request = (name: string) => callRoute(POST as never, {
      path: '/api/novel-promotion/project-1/character',
      method: 'POST',
      body: { name, description: '', episodeId: 'episode-1', idempotencyKey: key },
      context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
    })

    expect((await request('角色A')).status).toBe(200)
    expect((await request('角色B')).status).toBe(409)
    expect([...stores.character.values()][0]?.name).toBe('角色A')
  })

  it('同角色 key 原本無 episode，重播不得追加另一個 episode scope', async () => {
    const key = '66666666-6666-4666-8666-666666666666'
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/character/route')
    const request = (episodeId?: string) => callRoute(POST as never, {
      path: '/api/novel-promotion/project-1/character',
      method: 'POST',
      body: { name: '角色C', description: '', episodeId, idempotencyKey: key },
      context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
    })

    expect((await request()).status).toBe(200)
    expect((await request('episode-1')).status).toBe(409)
    expect(stores.character.size).toBe(1)
    expect(stores.episodeCharacter.size).toBe(0)
  })

  it('場景 upload flag + 同 key replay -> 保存 description、不生成AI、只建一組資料', async () => {
    const key = '33333333-3333-4333-8333-333333333333'
    const ids = deriveManualUploadIds('location', 'novel-data-id', key)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/location/route')
    const invoke = () => callRoute(POST as never, {
      path: '/api/novel-promotion/project-1/location',
      method: 'POST',
      body: {
        name: '雨夜停車場',
        description: '閃爍日光燈與潮濕地面',
        summary: '追逐場景',
        episodeId: 'episode-1',
        idempotencyKey: key,
        skipImageGeneration: true,
      },
      context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
    })

    expect((await invoke()).status).toBe(200)
    const replay = await invoke()
    expect(replay.status).toBe(200)
    const body = await replay.json()
    expect(body.location.id).toBe(ids.entityId)
    expect(body.location.images[0]).toEqual(expect.objectContaining({
      id: ids.primaryAssetId,
      description: '閃爍日光燈與潮濕地面',
    }))
    expect(stores.location.size).toBe(1)
    expect(stores.locationImage.size).toBe(1)
    expect(stores.episodeLocation.size).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('場景無 file 的文字模式 -> 同 key replay 不重複觸發背景生成', async () => {
    const key = '88888888-8888-4888-8888-888888888888'
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/location/route')
    const invoke = () => callRoute(POST as never, {
      path: '/api/novel-promotion/project-1/location',
      method: 'POST',
      body: {
        name: '天台',
        description: '清晨薄霧',
        idempotencyKey: key,
      },
      context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
    })

    expect((await invoke()).status).toBe(200)
    expect((await invoke()).status).toBe(200)
    expect(stores.location.size).toBe(1)
    expect(stores.locationImage.size).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('道具同 key replay -> 回同 entity/binding 且不走 legacy create', async () => {
    const key = '55555555-5555-4555-8555-555555555555'
    const ids = deriveManualUploadIds('prop', 'novel-data-id', key)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/prop/route')
    const invoke = () => callRoute(POST as never, {
      path: '/api/novel-promotion/project-1/prop',
      method: 'POST',
      body: {
        name: '銀色懷錶',
        summary: '傳家物',
        episodeId: 'episode-1',
        idempotencyKey: key,
      },
      context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
    })

    expect((await invoke()).status).toBe(200)
    const replay = await invoke()
    expect(replay.status).toBe(200)
    expect((await replay.json()).prop.id).toBe(ids.entityId)
    expect(stores.prop.size).toBe(1)
    expect(stores.episodeProp.size).toBe(1)
    expect(prismaMock.novelPromotionProp.create).not.toHaveBeenCalled()
    expect(prismaMock.episodeProp.create).not.toHaveBeenCalled()
  })

  it('相同 key 用於不同 project -> project-scoped IDs 不命中外專案 row', async () => {
    const key = '77777777-7777-4777-8777-777777777777'
    prismaMock.novelPromotionProject.findUnique.mockImplementation(async ({ where }) => ({
      id: `np-${where.projectId}`,
    }))
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/prop/route')
    const invoke = (projectId: string) => callRoute(POST as never, {
      path: `/api/novel-promotion/${projectId}/prop`,
      method: 'POST',
      body: { name: '同名道具', idempotencyKey: key },
      context: { params: Promise.resolve({ projectId }) } as never,
    })

    const first = await invoke('project-1')
    const second = await invoke('project-2')

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstId = (await first.json()).prop.id
    const secondId = (await second.json()).prop.id
    expect(firstId).not.toBe(secondId)
    expect(stores.prop.size).toBe(2)
  })
})
