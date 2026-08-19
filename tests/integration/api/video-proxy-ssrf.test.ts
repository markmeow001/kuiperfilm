import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

installAuthMocks()

const safeFetchMock = vi.hoisted(() => vi.fn())
const globalFetchMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: { findFirst: vi.fn() },
  novelPromotionStoryboard: { findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({
  getSignedUrl: vi.fn((key: string) => `/api/files/${encodeURIComponent(key)}`),
  toFetchableUrl: vi.fn((url: string) => url.startsWith('/') ? `http://localhost:3000${url}` : url),
}))
vi.mock('@/lib/http/ssrf-safe-fetch', () => ({
  fetchPublicResource: safeFetchMock,
  SsrfSafeFetchError: class SsrfSafeFetchError extends Error {
    code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  },
}))

const PROJECT_ID = 'project-A'

async function invoke(query: Record<string, string>) {
  const route = await import('@/app/api/novel-promotion/[projectId]/video-proxy/route')
  return await callRoute(route.GET as never, {
    path: `/api/novel-promotion/${PROJECT_ID}/video-proxy`,
    method: 'GET',
    query,
    context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
  })
}

describe('video-proxy SSRF-safe fetch boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-A')
    vi.stubGlobal('fetch', globalFetchMock)

    safeFetchMock.mockResolvedValue(new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': '3',
      },
    }))
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue({ id: 'panel-A' })
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([])
  })

  it('returns 404 and performs zero outbound work when no durable project media row has the exact key', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(null)

    const response = await invoke({
      key: 'video/another-project/clip.mp4',
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        storyboard: { episode: { novelPromotionProject: { projectId: PROJECT_ID } } },
        OR: [
          { videoUrl: 'video/another-project/clip.mp4' },
          { lipSyncVideoUrl: 'video/another-project/clip.mp4' },
        ],
      }),
    }))
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('matches multi-shot JSON entries exactly, never by substring', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(null)
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([{
      multiShotVideoUrl: 'video/project-A/first.mp4',
      multiShotClipUrls: JSON.stringify(['video/project-A/owned.mp4.evil']),
    }])

    const response = await invoke({
      key: 'video/project-A/owned.mp4',
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      }),
    }))
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('routes caller-supplied URLs only through the centralized safe fetcher', async () => {
    const response = await invoke({
      key: 'https://cdn.example/video.mp4',
      filename: 'shot-1',
    })

    expect(response.status).toBe(200)
    expect(safeFetchMock).toHaveBeenCalledWith(
      'https://cdn.example/video.mp4',
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        maxResponseBytes: expect.any(Number),
        allowedContentTypes: expect.arrayContaining(['video/mp4']),
      }),
    )
    expect(globalFetchMock).not.toHaveBeenCalled()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('allows only the exact generated local-storage origin for a storage key', async () => {
    const response = await invoke({ key: 'video/project-A/clip.mp4' })

    expect(response.status).toBe(200)
    expect(safeFetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/files/video%2Fproject-A%2Fclip.mp4',
      expect.objectContaining({
        trustedInternalOrigins: ['http://localhost:3000'],
      }),
    )
    expect(globalFetchMock).not.toHaveBeenCalled()
  })

  it('does not grant the internal-origin exception to a caller-supplied URL', async () => {
    await invoke({ key: 'http://localhost:3000/internal.mp4' })

    expect(safeFetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/internal.mp4',
      expect.not.objectContaining({ trustedInternalOrigins: expect.anything() }),
    )
  })

  it('accepts an exact multi-shot clip only when a scoped storyboard contains it', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(null)
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([{
      multiShotVideoUrl: 'video/project-A/clip-1.mp4',
      multiShotClipUrls: JSON.stringify([
        'video/project-A/clip-1.mp4',
        'video/project-A/clip-2.mp4',
      ]),
    }])

    const response = await invoke({
      key: 'video/project-A/clip-2.mp4',
    })

    expect(response.status).toBe(200)
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
  })
})
