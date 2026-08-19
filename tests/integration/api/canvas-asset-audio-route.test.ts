import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

installAuthMocks()

const cosMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://storage.example/${key}`),
  contentTypeForKey: vi.fn((key: string) => key.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream'),
}))

vi.mock('@/lib/cos', () => cosMock)

type RouteModule = typeof import('@/app/api/canvas/asset/route')
let route: RouteModule

beforeAll(async () => {
  route = await import('@/app/api/canvas/asset/route')
})

function request(key: string) {
  return new NextRequest(`http://localhost/api/canvas/asset?key=${encodeURIComponent(key)}`)
}

describe('/api/canvas/asset generated audio playback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    resetAuthMockState()
    mockAuthenticated('user-1')
  })

  it('[owned Canvas TTS WAV key] -> [streams audio through authenticated same-origin response]', async () => {
    const wav = Buffer.from('RIFF generated WAVE bytes')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(wav, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    }))

    const response = await route.GET(request(
      'voice/playground-ref/user-1/tts-node.wav',
    ), {} as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/wav')
    expect(response.headers.get('cache-control')).toBe('private, max-age=600')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(wav)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.example/voice/playground-ref/user-1/tts-node.wav',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('[WAV advertises more than 32 MiB] -> [rejects before buffering response body]', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(Buffer.from('small'), {
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'content-length': String(32 * 1024 * 1024 + 1),
      },
    }))

    const response = await route.GET(request(
      'voice/playground-ref/user-1/tts-node.wav',
    ), {} as never)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { details: { code: 'ASSET_TOO_LARGE' } },
    })
  })

  it('[foreign user audio key] -> [returns 403 before storage fetch]', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const response = await route.GET(request(
      'voice/playground-ref/other-user/tts-node.wav',
    ), {} as never)

    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
