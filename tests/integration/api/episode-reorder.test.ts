/**
 * Phase 11.1.5 episode reorder regression.
 *
 * Verifies validation + two-phase update behaviour of
 * POST /api/novel-promotion/:projectId/episodes/reorder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: { findUnique: vi.fn() },
  novelPromotionEpisode: {
    findMany: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock as unknown)),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock as unknown),
  )
  prismaMock.novelPromotionEpisode.update.mockImplementation(async () => ({}))
})

afterEach(() => {
  vi.resetAllMocks()
})

const PROJECT = 'project-1'

async function setupProjectWithEpisodes(
  episodes: Array<{ id: string; episodeNumber: number }>,
) {
  prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({ id: 'np-1' })
  prismaMock.novelPromotionEpisode.findMany.mockResolvedValueOnce(episodes)
  // The route runs a second findMany at the end to return the new order
  prismaMock.novelPromotionEpisode.findMany.mockResolvedValueOnce(
    [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber),
  )
}

describe('POST /episodes/reorder', () => {
  it('rejects empty order array', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/reorder/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/reorder`,
      method: 'POST',
      body: { order: [] },
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects duplicate ids in order', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/reorder/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/reorder`,
      method: 'POST',
      body: { order: ['ep1', 'ep1', 'ep2'] },
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects when supplied order references unknown episode id', async () => {
    await setupProjectWithEpisodes([
      { id: 'ep1', episodeNumber: 1 },
      { id: 'ep2', episodeNumber: 2 },
    ])

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/reorder/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/reorder`,
      method: 'POST',
      body: { order: ['ep1', 'ep-foreign'] },
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects partial reorder (missing some episodes)', async () => {
    await setupProjectWithEpisodes([
      { id: 'ep1', episodeNumber: 1 },
      { id: 'ep2', episodeNumber: 2 },
      { id: 'ep3', episodeNumber: 3 },
    ])

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/reorder/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/reorder`,
      method: 'POST',
      body: { order: ['ep2', 'ep1'] }, // ep3 missing
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('two-phase parks then places to avoid unique constraint collision', async () => {
    await setupProjectWithEpisodes([
      { id: 'ep1', episodeNumber: 1 },
      { id: 'ep2', episodeNumber: 2 },
      { id: 'ep3', episodeNumber: 3 },
    ])

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/reorder/route')
    const res = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT}/episodes/reorder`,
      method: 'POST',
      body: { order: ['ep3', 'ep1', 'ep2'] }, // reverse-ish reorder
      context: { params: Promise.resolve({ projectId: PROJECT }) } as never,
    })

    expect(res.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    // Phase A: 3 parks (each existing.episodeNumber + 1000)
    // Phase B: 3 placements (each to its target index+1)
    // Total: 6 update calls
    expect(prismaMock.novelPromotionEpisode.update).toHaveBeenCalledTimes(6)

    const calls = prismaMock.novelPromotionEpisode.update.mock.calls.map(
      (c) => c[0] as { where: { id: string }; data: { episodeNumber: number } },
    )
    // Phase A parks: numbers should jump to 1001/1002/1003
    expect(calls.slice(0, 3).map((c) => c.data.episodeNumber).sort()).toEqual([1001, 1002, 1003])
    // Phase B places: ep3→1, ep1→2, ep2→3
    expect(calls.slice(3)).toEqual([
      { where: { id: 'ep3' }, data: { episodeNumber: 1 } },
      { where: { id: 'ep1' }, data: { episodeNumber: 2 } },
      { where: { id: 'ep2' }, data: { episodeNumber: 3 } },
    ])
  })
})
