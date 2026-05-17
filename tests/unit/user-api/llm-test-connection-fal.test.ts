/**
 * Regression for the fal.ai ⚡ test-connection path.
 *
 * Pre-2026-05-17: clicking ⚡ on the fal provider card produced the
 * misleading red "✗ 自定义渠道需要提供 baseUrl" error because the UI's
 * mapToTestProvider fell fal through to 'custom' and the backend then
 * required a baseUrl. Real fal.ai keys do not need a baseUrl — the
 * SDK uses queue.fal.run. The fix adds a dedicated 'fal' provider in
 * both UI and backend that probes a never-existent request UUID and
 * reads the auth verdict from the response code.
 *
 * This test pins the verdict logic so the next refactor cannot
 * silently regress to "always green" or "always red".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { testLlmConnection } from '@/lib/user-api/llm-test-connection'

const PROBE_URL_PREFIX = 'https://queue.fal.run/fal-ai/fast-sdxl/requests/'
const PROBE_URL_SUFFIX = '/status'

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('testLlmConnection — fal', () => {
  it('uses the queue.fal.run status endpoint with Authorization: Key header', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await testLlmConnection({ provider: 'fal', apiKey: 'realkey-1234-5678' })
    expect(result.provider).toBe('fal')
    expect(result.message).toContain('fal.ai')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url.startsWith(PROBE_URL_PREFIX)).toBe(true)
    expect(url.endsWith(PROBE_URL_SUFFIX)).toBe(true)
    // The probe UUID should be a literal nil-uuid (zero) so it can
    // never collide with a real user request id. If anyone randomises
    // it later the request id mining for fal abuse-reporting breaks.
    expect(url).toContain('00000000-0000-0000-0000-000000000000')

    const headers = init.headers as Record<string, string>
    // Critical: fal uses "Key <key>", not "Bearer <key>". Bearer fails 401.
    expect(headers.Authorization).toBe('Key realkey-1234-5678')
  })

  it('treats 404 as success (auth OK, fake request id not found)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"detail":"Request not found"}', { status: 404 }),
    )
    const result = await testLlmConnection({ provider: 'fal', apiKey: 'realkey-1234' })
    expect(result.message).toContain('fal.ai')
  })

  it('treats 200 as success (rare but auth still accepted)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"status":"COMPLETED"}', { status: 200 }),
    )
    const result = await testLlmConnection({ provider: 'fal', apiKey: 'realkey-1234' })
    expect(result.message).toContain('fal.ai')
  })

  it('throws FAL_AUTH_FAILED on 401 invalid key credentials (well-shaped but rejected)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"detail":"invalid key credentials"}', { status: 401 }),
    )
    await expect(
      testLlmConnection({ provider: 'fal', apiKey: 'badkey-format-but-invalid' }),
    ).rejects.toThrow(/FAL_AUTH_FAILED/)
  })

  it('throws FAL_AUTH_FAILED on 401 missing-auth (malformed key)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"detail":"Authentication is required"}', { status: 401 }),
    )
    await expect(
      testLlmConnection({ provider: 'fal', apiKey: 'sk-totally-wrong-shape' }),
    ).rejects.toThrow(/FAL_AUTH_FAILED/)
  })

  it('surfaces the fal-side error body in the thrown message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"detail":"invalid key credentials"}', { status: 401 }),
    )
    await expect(
      testLlmConnection({ provider: 'fal', apiKey: 'badkey' }),
    ).rejects.toThrow(/invalid key credentials/)
  })

  it('still requires apiKey before hitting fetch (no silent network call on empty key)', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')
    await expect(
      testLlmConnection({ provider: 'fal', apiKey: '' }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does NOT require baseUrl (the regression we are fixing)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    )
    // Note: no baseUrl in the payload. Pre-fix code path here was
    // normaliseProvider returning 'custom' (because baseUrl was absent
    // but provider unknown), then requireBaseUrl throwing the
    // misleading 自定义渠道需要提供 baseUrl error. The fix routes fal
    // through its own case before baseUrl is even consulted.
    const result = await testLlmConnection({ provider: 'fal', apiKey: 'realkey' })
    expect(result.provider).toBe('fal')
  })
})
