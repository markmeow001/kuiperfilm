import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  novelPromotionPanel: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/service', () => ({
  resolveMediaRef: vi.fn(async () => null),
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
})

const PROJECT_ID = 'project-A'

describe('voice lines project and episode scope', () => {
  it('[查詢本集發言人] -> [只用指定 episodeId 讀取角色]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      { speaker: '角色A' },
      { speaker: '旁白' },
    ])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?speakersOnly=1&episodeId=episode-A1`,
      method: 'GET',
      query: { speakersOnly: '1', episodeId: 'episode-A1' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ speakers: ['角色A', '旁白'] })
    expect(prismaMock.novelPromotionEpisode.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'episode-A1',
        novelPromotionProject: { projectId: PROJECT_ID },
      },
    })
    expect(prismaMock.novelPromotionVoiceLine.findMany.mock.calls[0][0]).toMatchObject({
      where: { episodeId: 'episode-A1' },
    })
  })

  it('[speakersOnly 缺少 episodeId] -> [回傳 400 且不查詢台詞]', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?speakersOnly=1`,
      method: 'GET',
      query: { speakersOnly: '1' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionVoiceLine.findMany).not.toHaveBeenCalled()
  })

  it('[PATCH 傳入其他專案台詞] -> [回傳 404 且不更新]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { lineId: 'line-from-project-B', emotionPrompt: '生氣', emotionStrength: 0.8 },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'line-from-project-B',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
    })
    expect(prismaMock.novelPromotionVoiceLine.update).not.toHaveBeenCalled()
  })

  it('[情緒強度超出 0.1 至 1] -> [回傳 400 且不更新]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      id: 'line-A1',
      episodeId: 'episode-A1',
    })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { lineId: 'line-A1', emotionStrength: 1.5 },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionVoiceLine.update).not.toHaveBeenCalled()
  })

  it('[DELETE 傳入其他專案台詞] -> [回傳 404 且不刪除]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(DELETE as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?lineId=line-from-project-B`,
      method: 'DELETE',
      query: { lineId: 'line-from-project-B' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.delete).not.toHaveBeenCalled()
  })
})
