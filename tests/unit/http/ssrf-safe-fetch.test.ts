import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SsrfSafeFetchError,
  createSsrfSafeFetcher,
  isBlockedOutboundAddress,
  type SsrfSafeFetchTransport,
} from '@/lib/http/ssrf-safe-fetch'

const VIDEO_OPTIONS = {
  timeoutMs: 1_000,
  maxResponseBytes: 8,
  allowedContentTypes: ['video/mp4'],
} as const

function addressFor(hostname: string): { address: string; family: 4 | 6 } {
  const addresses: Record<string, { address: string; family: 4 | 6 }> = {
    'public.example': { address: '93.184.216.34', family: 4 },
    'private.example': { address: '10.0.0.4', family: 4 },
  }
  return addresses[hostname] ?? { address: hostname, family: hostname.includes(':') ? 6 : 4 }
}

function makeFetcher(transport: SsrfSafeFetchTransport) {
  return createSsrfSafeFetcher({
    resolveHost: vi.fn(async (hostname: string) => [addressFor(hostname)]),
    transport,
  })
}

describe('SSRF-safe outbound fetch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '0:0:0:0:0:ffff:7f00:1',
    '64:ff9b::7f00:1',
    '2001::1',
    '2001:2::1',
    '2001:20::1',
    '2002:7f00:1::',
    'fec0::1',
  ])('blocks loopback, RFC1918, link-local, metadata, and IPv6-local address %s', (address) => {
    expect(isBlockedOutboundAddress(address)).toBe(true)
  })

  it('rejects every blocked DNS answer before opening a socket', async () => {
    const transport = vi.fn<SsrfSafeFetchTransport>()
    const safeFetch = createSsrfSafeFetcher({
      resolveHost: vi.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
        { address: '192.168.1.8', family: 4 as const },
      ]),
      transport,
    })

    await expect(safeFetch('https://mixed.example/video.mp4', VIDEO_OPTIONS)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    })
    expect(transport).not.toHaveBeenCalled()
  })

  it('blocks direct loopback and cloud metadata URLs before transport', async () => {
    const transport = vi.fn<SsrfSafeFetchTransport>()
    const safeFetch = makeFetcher(transport)

    await expect(safeFetch('http://127.0.0.1/video.mp4', VIDEO_OPTIONS)).rejects.toBeInstanceOf(SsrfSafeFetchError)
    await expect(safeFetch('http://169.254.169.254/latest/meta-data', VIDEO_OPTIONS)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    })
    expect(transport).not.toHaveBeenCalled()
  })

  it.each([
    'http://127.1/video.mp4',
    'http://2130706433/video.mp4',
    'http://0x7f000001/video.mp4',
    'http://[64:ff9b::7f00:1]/video.mp4',
    'http://[2002:7f00:1::]/video.mp4',
  ])('blocks alternate literal encodings before transport: %s', async (url) => {
    const transport = vi.fn<SsrfSafeFetchTransport>()
    const safeFetch = makeFetcher(transport)

    await expect(safeFetch(url, VIDEO_OPTIONS)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    })
    expect(transport).not.toHaveBeenCalled()
  })

  it.each([
    '64:ff9b::7f00:1',
    '2001::1',
    '2001:2::1',
    '2001:20::1',
    '2002:7f00:1::',
    'fec0::1',
  ])('blocks a special-use resolved AAAA answer before transport: %s', async (address) => {
    const transport = vi.fn<SsrfSafeFetchTransport>()
    const safeFetch = createSsrfSafeFetcher({
      resolveHost: vi.fn(async () => [{ address, family: 6 as const }]),
      transport,
    })

    await expect(safeFetch('https://public.example/video.mp4', VIDEO_OPTIONS)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    })
    expect(transport).not.toHaveBeenCalled()
  })

  it.each([Number.NaN, -1, 1.5, 11])('rejects an unsafe redirect limit: %s', async (maxRedirects) => {
    const transport = vi.fn<SsrfSafeFetchTransport>()
    const safeFetch = makeFetcher(transport)

    await expect(safeFetch('https://public.example/video.mp4', {
      ...VIDEO_OPTIONS,
      maxRedirects,
    })).rejects.toMatchObject({ code: 'INVALID_REDIRECT' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('revalidates every redirect and blocks a redirect to a private address', async () => {
    const transport = vi.fn<SsrfSafeFetchTransport>(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://private.example/video.mp4' },
    }))
    const safeFetch = makeFetcher(transport)

    await expect(safeFetch('https://public.example/video.mp4', VIDEO_OPTIONS)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('times out DNS/connection work that does not settle', async () => {
    vi.useFakeTimers()
    const safeFetch = createSsrfSafeFetcher({
      resolveHost: vi.fn(() => new Promise<never>(() => undefined)),
      transport: vi.fn<SsrfSafeFetchTransport>(),
    })

    const pending = safeFetch('https://public.example/video.mp4', {
      ...VIDEO_OPTIONS,
      timeoutMs: 25,
    })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(26)
    await assertion
  })

  it('keeps the deadline active while the response body is streaming', async () => {
    vi.useFakeTimers()
    const transport = vi.fn<SsrfSafeFetchTransport>(async () => new Response(
      new ReadableStream<Uint8Array>({ start() {} }),
      { headers: { 'content-type': 'video/mp4' } },
    ))
    const safeFetch = makeFetcher(transport)

    const response = await safeFetch('https://public.example/video.mp4', {
      ...VIDEO_OPTIONS,
      timeoutMs: 25,
    })
    const body = response.arrayBuffer()
    const assertion = expect(body).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(26)
    await assertion
  })

  it('rejects a declared response larger than the byte budget', async () => {
    const transport = vi.fn<SsrfSafeFetchTransport>(async () => new Response('123456789', {
      headers: {
        'content-type': 'video/mp4',
        'content-length': '9',
      },
    }))
    const safeFetch = makeFetcher(transport)

    await expect(safeFetch('https://public.example/video.mp4', VIDEO_OPTIONS)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    })
  })

  it('cuts off a chunked response once it crosses the byte budget', async () => {
    const transport = vi.fn<SsrfSafeFetchTransport>(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2, 3, 4, 5]))
          controller.enqueue(Uint8Array.from([6, 7, 8, 9]))
          controller.close()
        },
      }),
      { headers: { 'content-type': 'video/mp4' } },
    ))
    const safeFetch = makeFetcher(transport)

    const response = await safeFetch('https://public.example/video.mp4', VIDEO_OPTIONS)
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('rejects missing or non-video content types instead of sniffing them', async () => {
    const transport = vi.fn<SsrfSafeFetchTransport>()
      .mockResolvedValueOnce(new Response('html', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('unknown'))
    const safeFetch = makeFetcher(transport)

    await expect(safeFetch('https://public.example/not-video', VIDEO_OPTIONS)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT_TYPE',
    })
    await expect(safeFetch('https://public.example/no-type', VIDEO_OPTIONS)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT_TYPE',
    })
  })

  it('permits an exact server-controlled internal origin without extending trust across redirects', async () => {
    const transport = vi.fn<SsrfSafeFetchTransport>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:4000/video.mp4' },
      }))
    const safeFetch = createSsrfSafeFetcher({
      resolveHost: vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]),
      transport,
    })

    await expect(safeFetch('http://127.0.0.1:3000/api/files/video%2Fclip.mp4', {
      ...VIDEO_OPTIONS,
      trustedInternalOrigins: ['http://127.0.0.1:3000'],
    })).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' })
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
