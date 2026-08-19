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
  },
}))
const safeFetchMock = vi.hoisted(() => vi.fn())
const cosMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://storage.example/${key}`),
  toFetchableUrl: vi.fn((value: string) => value),
}))

class MockSsrfSafeFetchError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/http/ssrf-safe-fetch', () => ({
  fetchPublicResource: safeFetchMock,
  SsrfSafeFetchError: MockSsrfSafeFetchError,
}))

function voiceLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-a',
    episodeId: 'episode-a',
    lineIndex: 1,
    speaker: 'Ann',
    content: 'Hello',
    audioUrl: 'voice/project-a/episode-a/line-a.wav',
    audioMediaId: null,
    audioMedia: null,
    ...overrides,
  }
}

describe('download-voices ownership and SSRF boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-a' })
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValue([voiceLine()])
    safeFetchMock.mockResolvedValue(new Response(Buffer.from('wav-data'), {
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'content-length': '8',
      },
    }))
  })

  it('[foreign episodeId] -> [404 且 0 line read / 0 fetch]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-a/download-voices?episodeId=episode-from-project-b',
      method: 'GET',
      query: { episodeId: 'episode-from-project-b' },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-from-project-b',
        novelPromotionProject: { projectId: 'project-a' },
      },
      select: { id: true },
    })
    expect(prismaMock.novelPromotionVoiceLine.findMany).not.toHaveBeenCalled()
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'https://attacker.example/raw.wav',
    'data:audio/wav;base64,ZmFrZQ==',
    '/m/media-from-another-user',
    'voice/project-b/episode-b/line-b.wav',
  ])('[persisted line source %s 無 exact media ownership] -> [400 且 0 outbound fetch]', async (audioUrl) => {
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      voiceLine({ audioUrl }),
    ])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-a/download-voices?episodeId=episode-a',
      method: 'GET',
      query: { episodeId: 'episode-a' },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['episode-scoped', '?episodeId=episode-a'],
    ['project-wide', ''],
  ])('[%s valid first line + invalid second line] -> [all-source preflight fails with zero outbound fetch]', async (_label, query) => {
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      voiceLine({ id: 'line-a', lineIndex: 1 }),
      voiceLine({
        id: 'line-b',
        lineIndex: 2,
        audioUrl: 'https://attacker.example/raw.wav',
      }),
    ])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-voices/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/project-a/download-voices${query}`,
      method: 'GET',
      ...(query ? { query: { episodeId: 'episode-a' } } : {}),
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('[owned /m relation] -> [只抓 relation storageKey 的 server-signed URL]', async () => {
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      voiceLine({
        audioUrl: '/m/public-a',
        audioMediaId: 'media-a',
        audioMedia: {
          id: 'media-a',
          publicId: 'public-a',
          storageKey: 'voice/project-a/episode-a/canonical.wav',
          mimeType: 'audio/wav',
          sizeBytes: BigInt(8),
        },
      }),
    ])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-a/download-voices?episodeId=episode-a',
      method: 'GET',
      query: { episodeId: 'episode-a' },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
    expect(safeFetchMock).toHaveBeenCalledWith(
      'https://storage.example/voice/project-a/episode-a/canonical.wav',
      expect.objectContaining({
        trustedInternalOrigins: ['https://storage.example'],
        allowedContentTypes: expect.arrayContaining(['audio/wav']),
        maxResponseBytes: expect.any(Number),
        timeoutMs: expect.any(Number),
      }),
    )
  })

  it('[immutable generated key] -> [accepts only exact project/episode/line + task hash + audio hash grammar]', async () => {
    const immutableKey = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      voiceLine({ audioUrl: immutableKey }),
    ])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-a/download-voices?episodeId=episode-a',
      method: 'GET',
      query: { episodeId: 'episode-a' },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(safeFetchMock).toHaveBeenCalledWith(
      `https://storage.example/${immutableKey}`,
      expect.objectContaining({ trustedInternalOrigins: ['https://storage.example'] }),
    )
  })

  it.each([
    `voice/project-a/episode-a/line-b/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`,
    `voice/project-a/episode-a/line-a/${'a'.repeat(31)}-${'b'.repeat(64)}.wav`,
    `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(63)}.wav`,
  ])('[forged immutable generated key %s] -> [400 and 0 outbound]', async (audioUrl) => {
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      voiceLine({ audioUrl }),
    ])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-a/download-voices?episodeId=episode-a',
      method: 'GET',
      query: { episodeId: 'episode-a' },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('[任一安全 fetch 失敗] -> [整包非 200，不回 partial zip]', async () => {
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      voiceLine({ id: 'line-a', lineIndex: 1 }),
      voiceLine({ id: 'line-b', lineIndex: 2, audioUrl: 'voice/project-a/episode-a/line-b.wav' }),
    ])
    safeFetchMock
      .mockResolvedValueOnce(new Response(Buffer.from('first'), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      }))
      .mockRejectedValueOnce(new MockSsrfSafeFetchError('TIMEOUT'))

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-a/download-voices?episodeId=episode-a',
      method: 'GET',
      query: { episodeId: 'episode-a' },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(502)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(safeFetchMock).toHaveBeenCalledTimes(2)
  })

  it('[全專案下載] -> [line query 自身仍鏈 project ownership]', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-a/download-voices',
      method: 'GET',
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenCalledWith({
      where: {
        audioUrl: { not: null },
        episode: { novelPromotionProject: { projectId: 'project-a' } },
      },
      orderBy: { lineIndex: 'asc' },
      select: expect.any(Object),
    })
  })
})
