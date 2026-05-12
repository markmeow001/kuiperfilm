/**
 * Multi-user data isolation regression tests.
 *
 * Covers the security audit fix df24e2f + 829ff12: every novel-promotion
 * child-resource route must chain ownership through
 *   findFirst({ where: { id, novelPromotionProject: { projectId } } })
 * so that user A passing user B's resource id returns 404 instead of
 * silently reading/mutating it.
 *
 * Strategy: mock requireProjectAuth* to always return the calling user's
 * own project (the layer-1 check is already covered elsewhere). Then mock
 * the relevant prisma findFirst — when the where clause does NOT match a
 * resource owned by the caller's project (simulated by returning null),
 * the route must reply 404. We assert both the response status AND that
 * the prisma call carried the projectChain in its where clause, so a
 * future regression that drops the chain breaks the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

// ---- prisma mock ---------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  novelPromotionCharacter: {
    findFirst: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionLocation: {
    findFirst: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionStoryboard: {
    findFirst: vi.fn(),
  },
  novelPromotionPanel: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

// Stub these so we don't pull in archiver / cos / media on import.
vi.mock('@/lib/cos', () => ({
  getCOSClient: vi.fn(),
  toFetchableUrl: (s: string) => s,
  getSignedUrl: (s: string) => s,
}))
vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: vi.fn(async () => null),
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
}))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (x: unknown) => x),
}))

// ---- harness -------------------------------------------------------------

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
})

afterEach(() => {
  vi.resetAllMocks()
})

const ATTACKER_PROJECT = 'project-of-user-A'
const VICTIM_EPISODE = 'episode-of-user-B'
const VICTIM_CHARACTER = 'character-of-user-B'
const VICTIM_PANEL = 'panel-of-user-B'

function expectChainedQuery(call: { where?: { novelPromotionProject?: { projectId?: string } } }) {
  expect(call.where?.novelPromotionProject).toBeDefined()
  expect(call.where?.novelPromotionProject?.projectId).toBe(ATTACKER_PROJECT)
}

// ---- tests ---------------------------------------------------------------

describe('Multi-user isolation: novel-promotion child resources', () => {
  it('GET /episodes/[episodeId] — user A cannot read user B episode', async () => {
    // Attacker passes their own projectId (ownership passes layer 1) but a
    // victim episodeId. findFirst with projectChain returns null.
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const { GET } = await import(
      '@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route'
    )

    const res = await callRoute(GET, {
      path: `/api/novel-promotion/${ATTACKER_PROJECT}/episodes/${VICTIM_EPISODE}`,
      method: 'GET',
      context: {
        params: Promise.resolve({
          projectId: ATTACKER_PROJECT,
          episodeId: VICTIM_EPISODE,
        }),
      },
    })

    expect(res.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledTimes(1)
    const call = prismaMock.novelPromotionEpisode.findFirst.mock.calls[0][0]
    expect(call.where.id).toBe(VICTIM_EPISODE)
    expectChainedQuery(call)
    // The unsafe findUnique-by-id-only must NOT be called.
    expect(prismaMock.novelPromotionEpisode.findUnique).not.toHaveBeenCalled()
  })

  it('PATCH /episodes/[episodeId] — user A cannot mutate user B episode', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import(
      '@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route'
    )

    const res = await callRoute(PATCH, {
      path: `/api/novel-promotion/${ATTACKER_PROJECT}/episodes/${VICTIM_EPISODE}`,
      method: 'PATCH',
      body: { name: 'pwned' },
      context: {
        params: Promise.resolve({
          projectId: ATTACKER_PROJECT,
          episodeId: VICTIM_EPISODE,
        }),
      },
    })

    expect(res.status).toBe(404)
    const call = prismaMock.novelPromotionEpisode.findFirst.mock.calls[0][0]
    expectChainedQuery(call)
    // The dangerous update without ownership check must NOT be called.
    expect(prismaMock.novelPromotionEpisode.update).not.toHaveBeenCalled()
  })

  it('DELETE /character — user A cannot delete user B character', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce(null)

    const { DELETE } = await import(
      '@/app/api/novel-promotion/[projectId]/character/route'
    )

    const res = await callRoute(DELETE, {
      path: `/api/novel-promotion/${ATTACKER_PROJECT}/character?id=${VICTIM_CHARACTER}`,
      method: 'DELETE',
      query: { id: VICTIM_CHARACTER },
      context: {
        params: Promise.resolve({ projectId: ATTACKER_PROJECT }),
      },
    })

    expect(res.status).toBe(404)
    const call = prismaMock.novelPromotionCharacter.findFirst.mock.calls[0][0]
    expect(call.where.id).toBe(VICTIM_CHARACTER)
    expectChainedQuery(call)
    expect(prismaMock.novelPromotionCharacter.delete).not.toHaveBeenCalled()
  })

  it('PATCH /location — user A cannot mutate user B location', async () => {
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import(
      '@/app/api/novel-promotion/[projectId]/location/route'
    )

    const res = await callRoute(PATCH, {
      path: `/api/novel-promotion/${ATTACKER_PROJECT}/location`,
      method: 'PATCH',
      body: { locationId: 'location-of-user-B', name: 'pwned' },
      context: {
        params: Promise.resolve({ projectId: ATTACKER_PROJECT }),
      },
    })

    expect(res.status).toBe(404)
    const call = prismaMock.novelPromotionLocation.findFirst.mock.calls[0][0]
    expect(call.where.id).toBe('location-of-user-B')
    expectChainedQuery(call)
    expect(prismaMock.novelPromotionLocation.update).not.toHaveBeenCalled()
  })

  it('PATCH /panel (panelId path) — user A cannot mutate user B panel', async () => {
    // Panel chain: panel → storyboard → episode → project
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import(
      '@/app/api/novel-promotion/[projectId]/panel/route'
    )

    const res = await callRoute(PATCH, {
      path: `/api/novel-promotion/${ATTACKER_PROJECT}/panel`,
      method: 'PATCH',
      body: { panelId: VICTIM_PANEL, videoPrompt: 'pwned' },
      context: {
        params: Promise.resolve({ projectId: ATTACKER_PROJECT }),
      },
    })

    expect(res.status).toBe(404)
    const call = prismaMock.novelPromotionPanel.findFirst.mock.calls[0][0]
    expect(call.where.id).toBe(VICTIM_PANEL)
    // panel chains through storyboard → episode → project
    expect(call.where.storyboard?.episode?.novelPromotionProject?.projectId).toBe(
      ATTACKER_PROJECT,
    )
  })

  it('GET /speaker-voice — user A cannot read user B episode speaker voices', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const { GET } = await import(
      '@/app/api/novel-promotion/[projectId]/speaker-voice/route'
    )

    const res = await callRoute(GET, {
      path: `/api/novel-promotion/${ATTACKER_PROJECT}/speaker-voice?episodeId=${VICTIM_EPISODE}`,
      method: 'GET',
      query: { episodeId: VICTIM_EPISODE },
      context: {
        params: Promise.resolve({ projectId: ATTACKER_PROJECT }),
      },
    })

    expect(res.status).toBe(404)
    const call = prismaMock.novelPromotionEpisode.findFirst.mock.calls[0][0]
    expect(call.where.id).toBe(VICTIM_EPISODE)
    expectChainedQuery(call)
  })
})
