import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'

type AuthMode = 'editor' | 'viewer'

const authState = vi.hoisted(() => ({ mode: 'editor' as AuthMode }))

const txMock = vi.hoisted(() => ({
  characterAppearance: { create: vi.fn() },
  episodeCharacter: { upsert: vi.fn() },
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(
    async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
  ),
  novelPromotionCharacter: { findFirst: vi.fn() },
  novelPromotionEpisode: { findFirst: vi.fn(), findMany: vi.fn() },
}))

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

const projectCharacter = {
  id: 'character-1',
  name: '林真',
  novelPromotionProjectId: 'novel-project-1',
  appearances: [{ appearanceIndex: 0 }, { appearanceIndex: 2 }],
}

async function invoke(body: unknown) {
  const { POST } = await import(
    '@/app/api/novel-promotion/[projectId]/character/appearance/route'
  )
  return callRoute(POST as never, {
    path: '/api/novel-promotion/project-1/character/appearance',
    method: 'POST',
    body,
    context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
  })
}

describe('POST character/appearance episode binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.mode = 'editor'
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue(projectCharacter)
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-7' })
    txMock.characterAppearance.create.mockResolvedValue({
      id: 'appearance-3',
      characterId: 'character-1',
      appearanceIndex: 3,
      changeReason: '第七集雨衣',
      description: '黃色雨衣',
    })
    txMock.episodeCharacter.upsert.mockResolvedValue({ id: 'episode-character-1' })
  })

  it('指定 episode -> 驗證 project/episode/character chain 並在同一交易只綁該集', async () => {
    const response = await invoke({
      characterId: 'character-1',
      episodeId: 'episode-7',
      changeReason: ' 第七集雨衣 ',
      description: ' 黃色雨衣 ',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      appearance: {
        id: 'appearance-3',
        characterId: 'character-1',
        appearanceIndex: 3,
        changeReason: '第七集雨衣',
        description: '黃色雨衣',
      },
    })
    expect(prismaMock.novelPromotionCharacter.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'character-1',
        novelPromotionProject: { projectId: 'project-1' },
      },
      select: {
        id: true,
        name: true,
        novelPromotionProjectId: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          select: { appearanceIndex: true },
        },
      },
    })
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-7',
        novelPromotionProjectId: 'novel-project-1',
      },
      select: { id: true },
    })
    expect(txMock.characterAppearance.create).toHaveBeenCalledWith({
      data: {
        characterId: 'character-1',
        appearanceIndex: 3,
        changeReason: '第七集雨衣',
        description: '黃色雨衣',
        descriptions: JSON.stringify(['黃色雨衣']),
        imageUrls: JSON.stringify([]),
        previousImageUrls: JSON.stringify([]),
      },
    })
    expect(txMock.episodeCharacter.upsert).toHaveBeenCalledWith({
      where: {
        episodeId_characterId: {
          episodeId: 'episode-7',
          characterId: 'character-1',
        },
      },
      update: { appearanceId: 'appearance-3' },
      create: {
        episodeId: 'episode-7',
        characterId: 'character-1',
        appearanceId: 'appearance-3',
        role: 'manual',
      },
    })
    expect(prismaMock.novelPromotionEpisode.findMany).not.toHaveBeenCalled()
  })

  it('未指定 episode -> 只建立 catalog appearance 且不寫任何 episode binding', async () => {
    const response = await invoke({
      characterId: 'character-1',
      changeReason: '宣傳照造型',
      description: '黑色西裝',
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.findMany).not.toHaveBeenCalled()
    expect(txMock.episodeCharacter.upsert).not.toHaveBeenCalled()
    expect(txMock.characterAppearance.create.mock.calls[0]?.[0].data).toMatchObject({
      characterId: 'character-1',
      changeReason: '宣傳照造型',
      description: '黑色西裝',
    })
  })

  it('episode 不屬於角色 project -> 404 且交易前停止', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)

    const response = await invoke({
      characterId: 'character-1',
      episodeId: 'foreign-episode',
      changeReason: '錯誤造型',
      description: '不應建立',
    })

    expect(response.status).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(txMock.characterAppearance.create).not.toHaveBeenCalled()
    expect(txMock.episodeCharacter.upsert).not.toHaveBeenCalled()
  })

  it('character 不屬於 URL project -> 404 且不查 episode、不進交易', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue(null)

    const response = await invoke({
      characterId: 'foreign-character',
      episodeId: 'episode-7',
      changeReason: '錯誤造型',
      description: '不應建立',
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('episode binding 失敗 -> 交易失敗並回非 2xx，不吞錯誤', async () => {
    txMock.episodeCharacter.upsert.mockRejectedValue(new Error('binding unavailable'))

    const response = await invoke({
      characterId: 'character-1',
      episodeId: 'episode-7',
      changeReason: '雨衣',
      description: '黃色雨衣',
    })

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      error: { code: 'EXTERNAL_ERROR' },
    })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(txMock.characterAppearance.create).toHaveBeenCalledTimes(1)
    expect(txMock.episodeCharacter.upsert).toHaveBeenCalledTimes(1)
  })

  it('viewer -> 403 且資料查詢與交易都不執行', async () => {
    authState.mode = 'viewer'

    const response = await invoke({
      characterId: 'character-1',
      episodeId: 'episode-7',
      changeReason: '雨衣',
      description: '黃色雨衣',
    })

    expect(response.status).toBe(403)
    expect(prismaMock.novelPromotionCharacter.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
