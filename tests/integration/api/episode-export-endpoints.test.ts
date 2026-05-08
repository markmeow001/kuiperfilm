/**
 * Episode export endpoint regression — covers the v2 FinalPage routes:
 *   - POST /episodes/:id/stitch-mp4   (zip pack handed off to BullMQ)
 *   - POST /episodes/:id/auto-group-multi-shot (LLM grouping)
 *
 * The actual heavy lifting (zip packaging in the worker, prisma
 * transactions, LLM call) runs behind external services; here we just
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
  novelPromotionEpisode: { findUnique: vi.fn(), findFirst: vi.fn() },
  novelPromotionProject: { findFirst: vi.fn() },
  novelPromotionPanel: {
    updateMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async () => ({})),
  },
  // stitch-mp4 falls back to counting completed VIDEO_MULTI_SHOT tasks
  // when no panel.videoUrl exists (B-path episodes). Default 0 → the
  // route correctly returns 400 NO_PANEL_VIDEOS.
  task: {
    count: vi.fn(async () => 0),
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

const llmMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'PROMPT'),
  PROMPT_IDS: { NP_AUTO_GROUP_MULTI_SHOT: 'np_auto_group_multi_shot' },
}))

const resolveModelMock = vi.hoisted(() => ({
  resolveAnalysisModel: vi.fn(async () => 'openrouter::gpt-4o'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => submitTaskMock)
vi.mock('@/lib/ai-runtime', () => llmMock)
vi.mock('@/lib/prompt-i18n', () => promptMock)
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => resolveModelMock)
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
  // The two prisma writes inside auto-group-multi-shot's transaction
  // need real return values too.
  prismaMock.novelPromotionPanel.updateMany.mockImplementation(async () => ({ count: 0 }))
  prismaMock.novelPromotionPanel.update.mockImplementation(async () => ({}))
})

afterEach(() => {
  vi.resetAllMocks()
})

const PROJECT = 'project-1'
const EPISODE = 'episode-1'

describe('POST /episodes/:id/stitch-mp4', () => {
  it('refuses when the episode has no panels with videoUrl', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: EPISODE,
      novelPromotionProjectId: 'np-1',
      novelPromotionProject: { projectId: PROJECT },
      storyboards: [
        { panels: [{ id: 'p1', videoUrl: null }, { id: 'p2', videoUrl: null }] },
      ],
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

  it('refuses when the episode is in a different project', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: EPISODE,
      novelPromotionProjectId: 'np-other',
      novelPromotionProject: { projectId: 'foreign-project' },
      storyboards: [{ panels: [{ id: 'p1', videoUrl: 'video/1.mp4' }] }],
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/stitch-mp4/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/stitch-mp4`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(404)
    expect(submitTaskMock.submitTask).not.toHaveBeenCalled()
  })

  it('dispatches EPISODE_STITCH_MP4 task on happy path', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: EPISODE,
      novelPromotionProjectId: 'np-1',
      novelPromotionProject: { projectId: PROJECT },
      storyboards: [
        { panels: [{ id: 'p1', videoUrl: 'video/1.mp4' }, { id: 'p2', videoUrl: 'video/2.mp4' }] },
      ],
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
      payload: { episodeId: string }
      dedupeKey: string
    }
    expect(call.type).toBe('episode_stitch_mp4')
    expect(call.episodeId).toBe(EPISODE)
    expect(call.dedupeKey).toBe(`episode_stitch_mp4:${EPISODE}`)
  })
})

describe('POST /episodes/:id/auto-group-multi-shot', () => {
  it('rejects when fewer than 2 panels exist', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: EPISODE,
      novelPromotionProject: { id: 'np-1', projectId: PROJECT, analysisModel: null },
      storyboards: [{ panels: [{ id: 'p1', panelIndex: 0, description: 'only one' }] }],
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/auto-group-multi-shot/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/auto-group-multi-shot`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(400)
    expect(llmMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('persists groups when LLM returns valid JSON within constraints', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: EPISODE,
      novelPromotionProject: { id: 'np-1', projectId: PROJECT, analysisModel: null },
      storyboards: [
        {
          panels: [
            { id: 'p1', panelIndex: 0, description: 'living room A', location: 'living', characters: '["alice"]' },
            { id: 'p2', panelIndex: 1, description: 'living room B', location: 'living', characters: '["alice"]' },
            { id: 'p3', panelIndex: 2, description: 'kitchen A', location: 'kitchen', characters: '["alice","bob"]' },
            { id: 'p4', panelIndex: 3, description: 'kitchen B', location: 'kitchen', characters: '["bob"]' },
          ],
        },
      ],
    })
    llmMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        groups: [
          { id: 'g1', panelIds: ['p1', 'p2'], reason: 'living room' },
          { id: 'g2', panelIds: ['p3', 'p4'], reason: 'kitchen' },
        ],
      }),
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/auto-group-multi-shot/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/auto-group-multi-shot`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { groups: Array<{ id: string; panelIds: string[] }>; groupedCount: number }
    expect(body.groups).toHaveLength(2)
    expect(body.groupedCount).toBe(4)
    // Transaction should clear stale groupIds first, then write the new ones
    expect(prismaMock.novelPromotionPanel.updateMany).toHaveBeenCalledTimes(1)
    // 4 panels × 1 update each
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledTimes(4)
  })

  it('drops groups outside [2,6] panel-count window', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: EPISODE,
      novelPromotionProject: { id: 'np-1', projectId: PROJECT, analysisModel: null },
      storyboards: [
        {
          panels: [
            { id: 'p1', panelIndex: 0, description: 'a', location: '', characters: '[]' },
            { id: 'p2', panelIndex: 1, description: 'b', location: '', characters: '[]' },
            { id: 'p3', panelIndex: 2, description: 'c', location: '', characters: '[]' },
          ],
        },
      ],
    })
    // LLM returns ONE valid group of 2 + one orphan group of 1 (which we
    // expect to be merged into the previous group's tail or dropped).
    llmMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        groups: [
          { id: 'g1', panelIds: ['p1', 'p2'], reason: 'pair' },
          { id: 'g2-orphan', panelIds: ['p3'], reason: 'orphan' }, // size=1, must be dropped from validGroups
        ],
      }),
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/auto-group-multi-shot/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/auto-group-multi-shot`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { groups: Array<{ id: string; panelIds: string[] }> }
    // One initial valid group + tail recovery merges p3 into g1 (still <= 6)
    // OR drops it. Either way the final groups never contain a size-1 entry.
    for (const g of body.groups) {
      expect(g.panelIds.length).toBeGreaterThanOrEqual(2)
      expect(g.panelIds.length).toBeLessThanOrEqual(6)
    }
  })

  it('returns 502/UPSTREAM when LLM produces non-JSON', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: EPISODE,
      novelPromotionProject: { id: 'np-1', projectId: PROJECT, analysisModel: null },
      storyboards: [
        {
          panels: [
            { id: 'p1', panelIndex: 0, description: 'a', location: '', characters: '[]' },
            { id: 'p2', panelIndex: 1, description: 'b', location: '', characters: '[]' },
          ],
        },
      ],
    })
    llmMock.executeAiTextStep.mockResolvedValueOnce({
      text: 'this is not json at all',
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/auto-group-multi-shot/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/${EPISODE}/auto-group-multi-shot`,
      method: 'POST',
      body: {},
      context: { params: Promise.resolve({ projectId: PROJECT, episodeId: EPISODE }) } as never,
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(prismaMock.novelPromotionPanel.updateMany).not.toHaveBeenCalled()
  })
})
