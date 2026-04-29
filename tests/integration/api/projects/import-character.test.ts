import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockUnauthenticated,
  resetAuthMockState,
} from '../../../helpers/auth'

/**
 * Phase 11.2 — POST /api/projects/[projectId]/import-character
 *
 * 從資產中心 (GlobalCharacter) 匯入角色到一個 project：
 *   - 複製 GlobalCharacter -> NovelPromotionCharacter（記錄 sourceGlobalCharacterId）
 *   - includeAppearances 預設 true：複製 GlobalCharacterAppearance -> CharacterAppearance
 *   - includeAppearances=false：只複製主 character
 *   - 不寫 EpisodeCharacter junction（episode 關聯由手動 UI 寫，role='manual'）
 *
 * 合約：
 *   - 200: { success: true, character: { id, name, sourceGlobalCharacterId, ... } }
 *   - 400: 缺 globalCharacterId
 *   - 401: 未登入
 *   - 403: 不擁有 project / GlobalCharacter 屬於別人
 *   - 404: project 不存在 / GlobalCharacter 不存在 / NovelPromotionProject 不存在
 */

// 內部 transaction client mock — route 用 prisma.$transaction(async (tx) => {...})
const txMock = vi.hoisted(() => ({
  novelPromotionCharacter: {
    create: vi.fn(),
  },
  characterAppearance: {
    createMany: vi.fn(),
  },
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  globalCharacter: {
    findUnique: vi.fn(),
  },
  novelPromotionCharacter: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('POST /api/projects/[projectId]/import-character', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()

    prismaMock.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      userId: 'user-a',
    })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'np-1' })

    txMock.novelPromotionCharacter.create.mockResolvedValue({ id: 'npc-1' })
    txMock.characterAppearance.createMany.mockResolvedValue({ count: 0 })

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
    )
  })

  it('未登入 -> 401', async () => {
    installAuthMocks()
    mockUnauthenticated()

    const mod = await import('@/app/api/projects/[projectId]/import-character/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-character',
      method: 'POST',
      body: { globalCharacterId: 'gc-1' },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(401)
    expect(txMock.novelPromotionCharacter.create).not.toHaveBeenCalled()
  })

  it('project 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.project.findUnique.mockResolvedValue(null)

    const mod = await import('@/app/api/projects/[projectId]/import-character/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-404/import-character',
      method: 'POST',
      body: { globalCharacterId: 'gc-1' },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-404' }) })
    expect(res.status).toBe(404)
    expect(txMock.novelPromotionCharacter.create).not.toHaveBeenCalled()
  })

  it('不擁有此 project (project.userId 不等於 session.user.id) -> 403', async () => {
    installAuthMocks()
    mockAuthenticated('user-b') // user-b 想存取 user-a 的 proj-1
    prismaMock.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      userId: 'user-a',
    })

    const mod = await import('@/app/api/projects/[projectId]/import-character/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-character',
      method: 'POST',
      body: { globalCharacterId: 'gc-1' },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(403)
    expect(txMock.novelPromotionCharacter.create).not.toHaveBeenCalled()
  })

  it('缺 globalCharacterId -> 400', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    const mod = await import('@/app/api/projects/[projectId]/import-character/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-character',
      method: 'POST',
      body: {},
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(400)
    expect(txMock.novelPromotionCharacter.create).not.toHaveBeenCalled()
  })

  it('GlobalCharacter 不存在 -> 404', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.globalCharacter.findUnique.mockResolvedValue(null)

    const mod = await import('@/app/api/projects/[projectId]/import-character/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-character',
      method: 'POST',
      body: { globalCharacterId: 'gc-missing' },
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(404)
    expect(txMock.novelPromotionCharacter.create).not.toHaveBeenCalled()
  })

  it('別人的 GlobalCharacter -> 403, 不寫入', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.globalCharacter.findUnique.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-b', // 不屬於 user-a
      name: 'Stolen',
      aliases: null,
      voiceId: null,
      voiceType: null,
      customVoiceUrl: null,
      customVoiceMediaId: null,
      profileData: null,
      profileConfirmed: false,
      appearances: [],
    })

    const mod = await import('@/app/api/projects/[projectId]/import-character/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-character',
      method: 'POST',
      body: { globalCharacterId: 'gc-1' },
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })
    expect(res.status).toBe(403)
    expect(txMock.novelPromotionCharacter.create).not.toHaveBeenCalled()
  })

  it('成功 + includeAppearances 預設 true -> 200, 寫入 NovelPromotionCharacter + 2 個 CharacterAppearance, sourceGlobalCharacterId 對', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    prismaMock.globalCharacter.findUnique.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-a',
      name: 'Hero',
      aliases: JSON.stringify(['英雄']),
      voiceId: 'v1',
      voiceType: 'qwen-designed',
      customVoiceUrl: null,
      customVoiceMediaId: 'media-1',
      profileData: null,
      profileConfirmed: true,
      appearances: [
        {
          id: 'ga-1',
          appearanceIndex: 0,
          changeReason: 'default',
          description: '主角',
          descriptions: null,
          imageUrl: 'https://cdn/hero-0.png',
          imageUrls: null,
          imageMediaId: 'm-0',
          selectedIndex: 0,
          previousImageUrl: null,
          previousImageUrls: null,
          previousDescription: null,
          previousDescriptions: null,
        },
        {
          id: 'ga-2',
          appearanceIndex: 1,
          changeReason: 'transformation',
          description: '主角变身',
          descriptions: null,
          imageUrl: 'https://cdn/hero-1.png',
          imageUrls: null,
          imageMediaId: 'm-1',
          selectedIndex: 0,
          previousImageUrl: null,
          previousImageUrls: null,
          previousDescription: null,
          previousDescriptions: null,
        },
      ],
    })
    txMock.novelPromotionCharacter.create.mockResolvedValue({ id: 'npc-1' })
    prismaMock.novelPromotionCharacter.findUnique.mockResolvedValue({
      id: 'npc-1',
      name: 'Hero',
      sourceGlobalCharacterId: 'gc-1',
      appearances: [{ id: 'ca-1' }, { id: 'ca-2' }],
    })

    const mod = await import('@/app/api/projects/[projectId]/import-character/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-character',
      method: 'POST',
      body: { globalCharacterId: 'gc-1' }, // 預設 includeAppearances 為 true
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })

    expect(res.status).toBe(200)

    // 創建 NovelPromotionCharacter，sourceGlobalCharacterId='gc-1'，name='Hero'
    expect(txMock.novelPromotionCharacter.create).toHaveBeenCalledTimes(1)
    const npcArg = txMock.novelPromotionCharacter.create.mock.calls[0][0]
    expect(npcArg.data).toEqual(expect.objectContaining({
      novelPromotionProjectId: 'np-1',
      name: 'Hero',
      sourceGlobalCharacterId: 'gc-1',
      voiceId: 'v1',
      voiceType: 'qwen-designed',
      profileConfirmed: true,
    }))

    // 用 createMany 寫入 2 個 appearance
    expect(txMock.characterAppearance.createMany).toHaveBeenCalledTimes(1)
    const caArg = txMock.characterAppearance.createMany.mock.calls[0][0]
    expect(caArg.data).toHaveLength(2)
    expect(caArg.data[0]).toEqual(expect.objectContaining({
      characterId: 'npc-1',
      appearanceIndex: 0,
      description: '主角',
    }))
    expect(caArg.data[1]).toEqual(expect.objectContaining({
      characterId: 'npc-1',
      appearanceIndex: 1,
      description: '主角变身',
    }))

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.character.sourceGlobalCharacterId).toBe('gc-1')
  })

  it('includeAppearances=false -> 200, 只創建 character, 不複製 appearance', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')

    prismaMock.globalCharacter.findUnique.mockResolvedValue({
      id: 'gc-2',
      userId: 'user-a',
      name: 'Solo',
      aliases: null,
      voiceId: null,
      voiceType: null,
      customVoiceUrl: null,
      customVoiceMediaId: null,
      profileData: null,
      profileConfirmed: false,
      appearances: [
        {
          id: 'ga-x',
          appearanceIndex: 0,
          changeReason: 'default',
          description: '...',
          descriptions: null,
          imageUrl: null,
          imageUrls: null,
          imageMediaId: null,
          selectedIndex: 0,
          previousImageUrl: null,
          previousImageUrls: null,
          previousDescription: null,
          previousDescriptions: null,
        },
      ],
    })
    txMock.novelPromotionCharacter.create.mockResolvedValue({ id: 'npc-2' })
    prismaMock.novelPromotionCharacter.findUnique.mockResolvedValue({
      id: 'npc-2',
      name: 'Solo',
      sourceGlobalCharacterId: 'gc-2',
      appearances: [],
    })

    const mod = await import('@/app/api/projects/[projectId]/import-character/route')
    const req = buildMockRequest({
      path: '/api/projects/proj-1/import-character',
      method: 'POST',
      body: { globalCharacterId: 'gc-2', includeAppearances: false },
    })
    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'proj-1' }) })

    expect(res.status).toBe(200)
    expect(txMock.novelPromotionCharacter.create).toHaveBeenCalledTimes(1)
    // includeAppearances=false 時 createMany 不應被呼叫（沒東西可寫）
    expect(txMock.characterAppearance.createMany).not.toHaveBeenCalled()
  })
})
