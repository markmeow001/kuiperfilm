import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockUnauthenticated,
  resetAuthMockState,
} from '../../../helpers/auth'

const IMMUTABLE_VOICE_LINE_KEY =
  `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`
const SIGNED_VOICE_LINE_URL = `https://cos.example/${IMMUTABLE_VOICE_LINE_KEY}?q-signature=fake`
const MEDIA_ALIAS = '/m/voice-line-task-output'

const prismaMock = vi.hoisted(() => ({
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}))
const routeTaskMock = vi.hoisted(() => ({
  maybeSubmitLLMTask: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/llm-observe/route-task', () => routeTaskMock)
vi.mock('@/lib/cos', () => ({
  extractCOSKey: (value: string | null | undefined) => {
    if (!value) return null
    const normalized = value.trim()
    if (/^https?:\/\//i.test(normalized)) {
      return decodeURIComponent(new URL(normalized).pathname).replace(/^\/+/, '')
    }
    return normalized.replace(/^\/+/, '')
  },
}))

describe('api specific - reference to character route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    prismaMock.mediaObject.findUnique.mockImplementation(async (args: {
      where?: { publicId?: string }
    }) => args.where?.publicId === 'voice-line-task-output'
      ? {
          id: 'media-voice-output',
          publicId: 'voice-line-task-output',
          storageKey: IMMUTABLE_VOICE_LINE_KEY,
          sha256: null,
          mimeType: 'audio/wav',
          sizeBytes: 1,
          width: null,
          height: null,
          durationMs: null,
          updatedAt: new Date('2026-08-12T00:00:00.000Z'),
          uploadedByUserId: 'user-a',
        }
      : null)
  })

  it('returns unauthorized when user is not authenticated', async () => {
    installAuthMocks()
    mockUnauthenticated()
    const mod = await import('@/app/api/asset-hub/reference-to-character/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/reference-to-character',
      method: 'POST',
      body: {
        referenceImageUrl: 'https://example.com/ref.png',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
  })

  it('returns invalid params when references are missing', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    const mod = await import('@/app/api/asset-hub/reference-to-character/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/reference-to-character',
      method: 'POST',
      body: {},
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
  })

  it.each([
    ['raw task output', IMMUTABLE_VOICE_LINE_KEY],
    ['signed task output', SIGNED_VOICE_LINE_URL],
    ['/m task output alias', MEDIA_ALIAS],
  ])('[asset-hub reference-to-character + %s] -> rejects before task submission', async (
    _label,
    referenceImageUrl,
  ) => {
    installAuthMocks()
    mockAuthenticated('user-a')
    const mod = await import('@/app/api/asset-hub/reference-to-character/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/reference-to-character',
      method: 'POST',
      body: { referenceImageUrl, async: true },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    const responseBody = await res.json()
    expect(res.status).toBe(400)
    expect(responseBody.error.details.code).toBe('VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN')
    expect(routeTaskMock.maybeSubmitLLMTask).not.toHaveBeenCalled()
  })

  it('[project reference-to-character + signed task output] -> rejects before task submission', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    const mod = await import('@/app/api/novel-promotion/[projectId]/reference-to-character/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-a/reference-to-character',
      method: 'POST',
      body: { referenceImageUrls: [SIGNED_VOICE_LINE_URL], async: true },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-a' }) })
    const responseBody = await res.json()
    expect(res.status).toBe(400)
    expect(responseBody.error.details.code).toBe('VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN')
    expect(routeTaskMock.maybeSubmitLLMTask).not.toHaveBeenCalled()
  })

  it('[safe wrapped reference] -> submits only the normalized reference fields', async () => {
    installAuthMocks()
    mockAuthenticated('user-a')
    routeTaskMock.maybeSubmitLLMTask.mockResolvedValueOnce(new Response(
      JSON.stringify({ success: true, taskId: 'task-reference-1' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const mod = await import('@/app/api/asset-hub/reference-to-character/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/reference-to-character',
      method: 'POST',
      body: {
        referenceImageUrl: '/_next/image?url=images%2Fuser-a%2Fref.png&w=640&q=75',
        async: true,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const submission = routeTaskMock.maybeSubmitLLMTask.mock.calls.at(-1)?.[0] as {
      body?: Record<string, unknown>
    } | undefined
    expect(submission?.body).toMatchObject({
      referenceImageUrl: 'images/user-a/ref.png',
      referenceImageUrls: ['images/user-a/ref.png'],
    })
  })
})
