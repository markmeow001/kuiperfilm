/**
 * Episode export endpoint regression — covers the v2 FinalPage routes:
 *   - POST /episodes/:id/stitch-mp4   (zip pack handed off to BullMQ)
 *
 * The actual heavy lifting (zip packaging in the worker, prisma
 * transactions) runs behind external services; here we just
 * exercise the route handlers' validation + dispatch logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionProject: { findFirst: vi.fn() },
  novelPromotionPanel: {
    updateMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async () => ({})),
  },
  task: {
    findMany: vi.fn(async () => []),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock as unknown)),
}))

const submitTaskMock = vi.hoisted(() => ({
  submitTask: vi.fn(async (_args: Record<string, unknown>) => ({
    task: {
      id: 'task-1',
      type: 'episode_stitch_mp4',
      status: 'queued',
      userId: 'user-A',
      projectId: 'project-1',
      createdAt: new Date('2026-05-01T00:00:00Z').toISOString(),
    },
    deduped: false,
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => submitTaskMock)
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock as unknown),
  )
  // Re-arm submitTask after clearAllMocks wipes the hoisted default
  // (otherwise it returns undefined → NextResponse.json fails to
  // serialise).
  submitTaskMock.submitTask.mockImplementation(async () => ({
    task: {
      id: 'task-1',
      type: 'episode_stitch_mp4',
      status: 'queued',
      userId: 'user-A',
      projectId: 'project-1',
      createdAt: new Date('2026-05-01T00:00:00Z').toISOString(),
    },
    deduped: false,
  }))
})

afterEach(() => {
  vi.resetAllMocks()
})

const PROJECT = 'project-1'
const EPISODE = 'episode-1'

describe('POST /episodes/:id/stitch-mp4', () => {
  it('refuses when the episode has no delivery inputs', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: EPISODE,
      name: 'Episode 1',
      stitchStatus: null,
      stitchedVideoUrl: null,
      stitchedAt: null,
      storyboards: [
        {
          id: 'storyboard-1',
          createdAt: new Date(),
          panels: [{
            id: 'p1', panelIndex: 1, description: null, imageUrl: null,
            videoUrl: null, lipSyncVideoUrl: null, cameraMove: null,
            shotType: null, multiShotGroupId: null,
          }],
        },
      ],
      voiceLines: [],
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/stitch-mp4/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/stitch-mp4`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.details.code).toBe('NO_DELIVERY_INPUTS')
    expect(JSON.stringify(json)).not.toMatch(/[\u3400-\u9fff]/)
    expect(submitTaskMock.submitTask).not.toHaveBeenCalled()
  })

  it('refuses when the episode is in a different project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/stitch-mp4/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/stitch-mp4`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: EPISODE, novelPromotionProject: { projectId: PROJECT } },
    }))
    expect(submitTaskMock.submitTask).not.toHaveBeenCalled()
  })

  it('dispatches EPISODE_STITCH_MP4 task on happy path', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: EPISODE,
      name: 'Episode 1',
      stitchStatus: null,
      stitchedVideoUrl: null,
      stitchedAt: null,
      storyboards: [
        {
          id: 'storyboard-1',
          createdAt: new Date(),
          panels: [{
            id: 'p1', panelIndex: 1, description: null, imageUrl: 'images/1.jpg',
            videoUrl: 'video/1.mp4', lipSyncVideoUrl: 'video/1-lip.mp4', cameraMove: null,
            shotType: null, multiShotGroupId: null,
          }],
        },
      ],
      voiceLines: [],
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/stitch-mp4/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/stitch-mp4`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(200)
    expect(submitTaskMock.submitTask).toHaveBeenCalledTimes(1)
    const call = submitTaskMock.submitTask.mock.calls[0][0] as unknown as {
      type: string
      episodeId: string
      payload: { episodeId: string; sourceFingerprint: string }
      dedupeKey: string
    }
    expect(call.type).toBe('episode_stitch_mp4')
    expect(call.episodeId).toBe(EPISODE)
    expect(call.payload.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(call.dedupeKey).toBe(`episode_stitch_mp4:${EPISODE}`)
  })

  it('dispatches when the canonical snapshot contains image-only panels', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: EPISODE,
      name: 'Episode 1',
      stitchStatus: null,
      stitchedVideoUrl: null,
      stitchedAt: null,
      storyboards: [{
        id: 'storyboard-1',
        createdAt: new Date(),
        panels: [{
          id: 'p-image', panelIndex: 1, description: null, imageUrl: 'images/only.jpg',
          videoUrl: null, lipSyncVideoUrl: null, cameraMove: null,
          shotType: null, multiShotGroupId: null,
        }],
      }],
      voiceLines: [],
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/stitch-mp4/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/stitch-mp4`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(200)
    expect(submitTaskMock.submitTask).toHaveBeenCalledTimes(1)
  })

  it('dispatches when the canonical snapshot contains only generated voice audio', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: EPISODE,
      name: 'Episode 1',
      stitchStatus: null,
      stitchedVideoUrl: null,
      stitchedAt: null,
      storyboards: [],
      voiceLines: [{
        id: 'line-1', episodeId: EPISODE, lineIndex: 1,
        speaker: 'Ann', content: 'Voice only',
        audioUrl: `voice/${PROJECT}/${EPISODE}/line-1.wav`,
        audioMediaId: null, audioMedia: null,
        matchedPanelId: null, matchedPanelIndex: null,
      }],
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/stitch-mp4/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/stitch-mp4`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(200)
    expect(submitTaskMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }))
  })

  it('rejects an unsafe selected source before task submission', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: EPISODE,
      name: 'Episode 1',
      stitchStatus: null,
      stitchedVideoUrl: null,
      stitchedAt: null,
      storyboards: [{
        id: 'storyboard-1',
        createdAt: new Date(),
        panels: [{
          id: 'p-raw', panelIndex: 1, description: null, imageUrl: null,
          videoUrl: 'https://foreign.example/raw.mp4', lipSyncVideoUrl: null, cameraMove: null,
          shotType: null, multiShotGroupId: null,
        }],
      }],
      voiceLines: [],
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/stitch-mp4/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/stitch-mp4`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(400)
    expect(submitTaskMock.submitTask).not.toHaveBeenCalled()
  })
})
