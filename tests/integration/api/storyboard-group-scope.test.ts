import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

installAuthMocks()

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  novelPromotionStoryboard: {
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
  novelPromotionPanel: {
    deleteMany: vi.fn(),
  },
  novelPromotionClip: {
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const PROJECT_ID = 'project-1'
const EPISODE_ID = 'episode-1'

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
  prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock))
  prismaMock.novelPromotionPanel.deleteMany.mockResolvedValue({ count: 2 })
  prismaMock.novelPromotionStoryboard.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.novelPromotionClip.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.novelPromotionClip.deleteMany.mockResolvedValue({ count: 1 })
})

async function callPut(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/novel-promotion/[projectId]/storyboard-group/route')
  return callRoute(PUT as never, {
    path: `/api/novel-promotion/${PROJECT_ID}/storyboard-group`,
    method: 'PUT',
    body,
    context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
  })
}

async function callDelete(storyboardId: string) {
  const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/storyboard-group/route')
  return callRoute(DELETE as never, {
    path: `/api/novel-promotion/${PROJECT_ID}/storyboard-group?storyboardId=${storyboardId}`,
    method: 'DELETE',
    context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
  })
}

describe('storyboard-group PUT/DELETE project scope', () => {
  it('[PUT foreign episode] -> 404 且零 update', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const response = await callPut({
      episodeId: 'foreign-episode',
      clipId: 'foreign-clip',
      direction: 'up',
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign-episode',
        novelPromotionProject: { projectId: PROJECT_ID },
      },
      include: { clips: { orderBy: { createdAt: 'asc' } } },
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionClip.updateMany).not.toHaveBeenCalled()
  })

  it('[PUT clip 不在 scoped episode] -> 404 且零 update', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: EPISODE_ID,
      clips: [{ id: 'clip-in-episode', createdAt: new Date('2026-01-01T00:00:00Z') }],
    })

    const response = await callPut({
      episodeId: EPISODE_ID,
      clipId: 'foreign-clip',
      direction: 'down',
    })

    expect(response.status).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionClip.updateMany).not.toHaveBeenCalled()
  })

  it('[PUT scoped episode + clip] -> 只交換同 episode 查回的兩個 clip', async () => {
    const firstDate = new Date('2026-01-01T00:00:00Z')
    const secondDate = new Date('2026-01-01T00:00:10Z')
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: EPISODE_ID,
      clips: [
        { id: 'clip-1', createdAt: firstDate },
        { id: 'clip-2', createdAt: secondDate },
      ],
    })

    const response = await callPut({
      episodeId: EPISODE_ID,
      clipId: 'clip-2',
      direction: 'up',
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionClip.updateMany.mock.calls.map(([call]) => call)).toEqual([
      {
        where: {
          id: 'clip-2',
          episodeId: EPISODE_ID,
          episode: { novelPromotionProject: { projectId: PROJECT_ID } },
        },
        data: { createdAt: new Date(0) },
      },
      {
        where: {
          id: 'clip-1',
          episodeId: EPISODE_ID,
          episode: { novelPromotionProject: { projectId: PROJECT_ID } },
        },
        data: { createdAt: secondDate },
      },
      {
        where: {
          id: 'clip-2',
          episodeId: EPISODE_ID,
          episode: { novelPromotionProject: { projectId: PROJECT_ID } },
        },
        data: { createdAt: firstDate },
      },
    ])
  })

  it('[PUT transaction 前後 clip membership 改變] -> 404 且 transaction rollback', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: EPISODE_ID,
      clips: [
        { id: 'clip-1', createdAt: new Date('2026-01-01T00:00:00Z') },
        { id: 'clip-2', createdAt: new Date('2026-01-01T00:00:10Z') },
      ],
    })
    prismaMock.novelPromotionClip.updateMany.mockResolvedValueOnce({ count: 0 })

    const response = await callPut({
      episodeId: EPISODE_ID,
      clipId: 'clip-2',
      direction: 'up',
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionClip.updateMany).toHaveBeenCalledTimes(1)
  })

  it('[DELETE foreign storyboard] -> 404 且零 delete', async () => {
    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValueOnce(null)

    const response = await callDelete('foreign-storyboard')

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign-storyboard',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
      include: {
        panels: true,
        clip: true,
      },
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionPanel.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionStoryboard.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionClip.deleteMany).not.toHaveBeenCalled()
  })

  it('[DELETE scoped storyboard] -> 每個 delete 都帶 project ownership chain', async () => {
    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValueOnce({
      id: 'storyboard-1',
      clipId: 'clip-1',
      panels: [{ id: 'panel-1' }, { id: 'panel-2' }],
      clip: { id: 'clip-1' },
    })

    const response = await callDelete('storyboard-1')

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionPanel.deleteMany).toHaveBeenCalledWith({
      where: {
        storyboardId: 'storyboard-1',
        storyboard: {
          episode: { novelPromotionProject: { projectId: PROJECT_ID } },
        },
      },
    })
    expect(prismaMock.novelPromotionStoryboard.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'storyboard-1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
    })
    expect(prismaMock.novelPromotionClip.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'clip-1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
    })
  })
})
