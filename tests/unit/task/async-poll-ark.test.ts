/**
 * ARK (火山方舟) video task poll response parsing.
 *
 * The Volcengine docs (https://www.volcengine.com/docs/82379/1520757)
 * describe `content` as an array of typed envelopes:
 *
 *   { status: 'succeeded',
 *     content: [{ type: 'video_url', video_url: { url: 'https://...' } }] }
 *
 * Pre-2026-05-22 the poll handler read `queryData.content?.video_url`
 * — the 1.x-era object shape — which silently returned undefined for
 * every Seedance 2.0 job. The fix reads array-first, with a tolerant
 * fallback for any backend that still returns an object envelope (so
 * a downgrade or A/B rollout can't break us).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'ark:default',
  apiKey: 'ark-key',
})))

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

import { pollAsyncTask } from '@/lib/async-poll'

describe('async poll ARK video status mapping', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({ id: 'ark:default', apiKey: 'ark-key' })
    fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
  })

  it('extracts video URL from content[] array (Seedance 2.0 spec shape)', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'succeeded',
        content: [
          { type: 'video_url', video_url: { url: 'https://ark.tos.example/clip.mp4' } },
        ],
      }),
    })

    const result = await pollAsyncTask('ARK:VIDEO:task_abc', 'user-1')
    expect(result.status).toBe('completed')
    expect(result.videoUrl).toBe('https://ark.tos.example/clip.mp4')
  })

  it('tolerates legacy object envelope (1.x-era backward compat)', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'succeeded',
        content: { video_url: { url: 'https://ark.tos.example/legacy.mp4' } },
      }),
    })

    const result = await pollAsyncTask('ARK:VIDEO:task_legacy', 'user-1')
    expect(result.status).toBe('completed')
    expect(result.videoUrl).toBe('https://ark.tos.example/legacy.mp4')
  })

  it('tolerates legacy object envelope with bare string video_url', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'succeeded',
        content: { video_url: 'https://ark.tos.example/bare.mp4' },
      }),
    })

    const result = await pollAsyncTask('ARK:VIDEO:task_bare', 'user-1')
    expect(result.status).toBe('completed')
    expect(result.videoUrl).toBe('https://ark.tos.example/bare.mp4')
  })

  it('reports failed when content[] has no video_url entry', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'succeeded',
        content: [{ type: 'something_else', metadata: {} }],
      }),
    })

    const result = await pollAsyncTask('ARK:VIDEO:task_nourl', 'user-1')
    expect(result.status).toBe('failed')
    expect(result.error).toContain('No video URL')
  })

  it('maps API status=failed to pollResult.status=failed', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'failed',
        error: { code: 'INVALID_REQUEST', message: 'bad prompt' },
      }),
    })

    const result = await pollAsyncTask('ARK:VIDEO:task_bad', 'user-1')
    expect(result.status).toBe('failed')
    expect(result.error).toBe('bad prompt')
  })

  it('maps API status=queued/running to pending', async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'queued' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'running' }) })

    const queued = await pollAsyncTask('ARK:VIDEO:task_q', 'user-1')
    const running = await pollAsyncTask('ARK:VIDEO:task_r', 'user-1')

    expect(queued.status).toBe('pending')
    expect(running.status).toBe('pending')
  })
})
