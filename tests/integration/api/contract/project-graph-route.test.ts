import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({ authenticated: true }))
const accessState = vi.hoisted(() => ({
  allowed: true,
  reason: null as string | null,
  effectiveRole: 'viewer',
}))
const queryProjectGraphMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireUserAuth: async () => {
    if (!authState.authenticated) {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    return { session: { user: { id: 'user-viewer' } } }
  },
  requireProjectAccess: vi.fn(async () => ({ ...accessState })),
}))

vi.mock('@/lib/project-graph/query', () => ({
  queryProjectGraph: queryProjectGraphMock,
}))

const graphSource = {
  project: {
    id: 'project-1',
    name: 'Feature Film',
    updatedAt: new Date('2026-08-08T00:00:00.000Z'),
  },
  episodes: [
    {
      id: 'episode-1',
      episodeNumber: 1,
      name: 'Episode One',
      updatedAt: new Date('2026-08-08T00:00:00.000Z'),
      clips: [
        {
          id: 'clip-1',
          summary: 'Opening',
          start: 0,
          updatedAt: new Date('2026-08-08T00:00:00.000Z'),
          storyboard: {
            id: 'storyboard-1',
            episodeId: 'episode-1',
            panelCount: 1,
            updatedAt: new Date('2026-08-08T00:00:00.000Z'),
            panels: [
              {
                id: 'panel-1',
                panelIndex: 0,
                panelNumber: 1,
                shotType: 'medium',
                imageMediaId: 'media-image-1',
                videoMediaId: null,
                imageUrl: 'https://private.example/legacy.png',
                videoUrl: null,
                characters: null,
                location: null,
                updatedAt: new Date('2026-08-08T00:00:00.000Z'),
              },
            ],
          },
        },
      ],
    },
  ],
}

describe('GET /api/projects/[projectId]/graph', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    accessState.allowed = true
    accessState.reason = null
    accessState.effectiveRole = 'viewer'
    queryProjectGraphMock.mockResolvedValue({
      status: 'ok',
      source: graphSource,
      pageInfo: {
        limit: 20,
        totalEpisodes: 1,
        endCursor: 'episode-1',
        hasNextPage: false,
      },
    })
  })

  it('未登入時拒絕，且不查詢 graph', async () => {
    authState.authenticated = false
    const { GET } = await import('@/app/api/projects/[projectId]/graph/route')
    const request = buildMockRequest({
      path: '/api/projects/project-1/graph',
      method: 'GET',
    })

    const response = await GET(request, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(401)
    expect(queryProjectGraphMock).not.toHaveBeenCalled()
  })

  it('viewer 可讀唯讀投影，且不洩漏 URL、storage key 或 prompt', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/graph/route')
    const request = buildMockRequest({
      path: '/api/projects/project-1/graph',
      method: 'GET',
      query: { limit: 25 },
    })

    const response = await GET(request, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const payload = await response.json() as Record<string, unknown>
    const serialized = JSON.stringify(payload)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(payload).toMatchObject({
      schemaVersion: '1',
      projectId: 'project-1',
      pageInfo: {
        totalEpisodes: 1,
        endCursor: 'episode-1',
      },
    })
    expect(serialized).not.toContain('private.example')
    expect(serialized).not.toContain('storageKey')
    expect(serialized).not.toContain('externalId')
    expect(serialized).not.toContain('imagePrompt')
    expect(queryProjectGraphMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: undefined,
      cursor: undefined,
      limit: 25,
    })
  })

  it('無專案讀取權限時回 403', async () => {
    accessState.allowed = false
    accessState.reason = 'NO_ACCESS'
    const { GET } = await import('@/app/api/projects/[projectId]/graph/route')
    const request = buildMockRequest({
      path: '/api/projects/project-1/graph',
      method: 'GET',
    })

    const response = await GET(request, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(403)
    expect(queryProjectGraphMock).not.toHaveBeenCalled()
  })

  it('episodeId 必須屬於同專案，否則回 404', async () => {
    queryProjectGraphMock.mockResolvedValue({ status: 'episode_not_found' })
    const { GET } = await import('@/app/api/projects/[projectId]/graph/route')
    const request = buildMockRequest({
      path: '/api/projects/project-1/graph',
      method: 'GET',
      query: { episodeId: 'episode-other-project' },
    })

    const response = await GET(request, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(404)
    expect(queryProjectGraphMock).toHaveBeenCalledWith(expect.objectContaining({
      episodeId: 'episode-other-project',
    }))
  })

  it('拒絕無效 cursor 與 episodeId/cursor 混用', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/graph/route')
    const invalidCursorRequest = buildMockRequest({
      path: '/api/projects/project-1/graph',
      method: 'GET',
      query: { cursor: 'missing' },
    })
    queryProjectGraphMock.mockResolvedValueOnce({ status: 'cursor_not_found' })

    const invalidCursorResponse = await GET(invalidCursorRequest, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    expect(invalidCursorResponse.status).toBe(400)

    const mixedRequest = buildMockRequest({
      path: '/api/projects/project-1/graph',
      method: 'GET',
      query: { episodeId: 'episode-1', cursor: 'episode-0' },
    })
    const mixedResponse = await GET(mixedRequest, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    expect(mixedResponse.status).toBe(400)
  })

  it('limit 僅接受正整數並封頂 100', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/graph/route')
    const invalidRequest = buildMockRequest({
      path: '/api/projects/project-1/graph',
      method: 'GET',
      query: { limit: '1.5' },
    })
    const invalidResponse = await GET(invalidRequest, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    expect(invalidResponse.status).toBe(400)

    const cappedRequest = buildMockRequest({
      path: '/api/projects/project-1/graph',
      method: 'GET',
      query: { limit: '999' },
    })
    const cappedResponse = await GET(cappedRequest, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    expect(cappedResponse.status).toBe(200)
    expect(queryProjectGraphMock).toHaveBeenLastCalledWith(expect.objectContaining({
      limit: 100,
    }))
  })

  it('節點預算超限時明確拒絕，不回傳靜默截斷的圖', async () => {
    queryProjectGraphMock.mockResolvedValue({
      status: 'graph_too_large',
      sceneCount: 501,
      shotCount: 0,
      maxScenes: 500,
      maxShots: 2_500,
    })
    const { GET } = await import('@/app/api/projects/[projectId]/graph/route')
    const request = buildMockRequest({
      path: '/api/projects/project-1/graph',
      method: 'GET',
    })

    const response = await GET(request, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const payload = await response.json() as {
      error?: { details?: { code?: string } }
    }

    expect(response.status).toBe(400)
    expect(JSON.stringify(payload)).toContain('PROJECT_GRAPH_TOO_LARGE')
  })
})
