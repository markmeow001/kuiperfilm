/**
 * Regression for the AtlasCloud ⚡ test-connection path.
 *
 * Pre-2026-05-20: clicking ⚡ on the AtlasCloud provider card produced
 * the misleading red "✗ 自定义渠道需要提供 baseUrl" error because the
 * UI's mapToTestProvider fell atlascloud through to 'custom' and the
 * backend then required a baseUrl. AtlasCloud has no /v1/models
 * listing endpoint — the cheapest probe is a prediction lookup against
 * a nil-uuid that can never exist. The fix adds a dedicated
 * 'atlascloud' provider in both UI and backend.
 *
 * Mirrors the fal regression test (llm-test-connection-fal.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { testLlmConnection } from '@/lib/user-api/llm-test-connection'

const PROBE_URL = 'https://api.atlascloud.ai/api/v1/model/prediction/00000000-0000-0000-0000-000000000000'

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('testLlmConnection — atlascloud', () => {
  it('uses the prediction endpoint with Authorization: Bearer header', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"code":404,"message":"Not Found"}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await testLlmConnection({ provider: 'atlascloud', apiKey: 'realkey-1234' })
    expect(result.provider).toBe('atlascloud')
    expect(result.message).toContain('AtlasCloud')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(PROBE_URL)

    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer realkey-1234')
  })

  it('treats 404 as success (auth OK, fake prediction id not found)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"code":404}', { status: 404 }),
    )
    const result = await testLlmConnection({ provider: 'atlascloud', apiKey: 'realkey' })
    expect(result.message).toContain('AtlasCloud')
  })

  it('treats 200 with non-200 business code as success (auth still accepted)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"code":4001,"message":"prediction not found"}', { status: 200 }),
    )
    const result = await testLlmConnection({ provider: 'atlascloud', apiKey: 'realkey' })
    expect(result.message).toContain('AtlasCloud')
  })

  it('throws ATLASCLOUD_AUTH_FAILED on 401', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"detail":"invalid token"}', { status: 401 }),
    )
    await expect(
      testLlmConnection({ provider: 'atlascloud', apiKey: 'badkey' }),
    ).rejects.toThrow(/ATLASCLOUD_AUTH_FAILED/)
  })

  it('throws ATLASCLOUD_AUTH_FAILED on 403', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"detail":"forbidden"}', { status: 403 }),
    )
    await expect(
      testLlmConnection({ provider: 'atlascloud', apiKey: 'expired' }),
    ).rejects.toThrow(/ATLASCLOUD_AUTH_FAILED/)
  })

  it('surfaces the AtlasCloud error body in the thrown message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"detail":"invalid token"}', { status: 401 }),
    )
    await expect(
      testLlmConnection({ provider: 'atlascloud', apiKey: 'badkey' }),
    ).rejects.toThrow(/invalid token/)
  })

  it('still requires apiKey before hitting fetch (no silent call on empty key)', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')
    await expect(
      testLlmConnection({ provider: 'atlascloud', apiKey: '' }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does NOT require baseUrl (the regression we are fixing)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    )
    const result = await testLlmConnection({ provider: 'atlascloud', apiKey: 'realkey' })
    expect(result.provider).toBe('atlascloud')
  })
})
