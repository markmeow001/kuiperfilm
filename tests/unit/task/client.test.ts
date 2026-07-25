import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForTaskResult } from '@/lib/task/client'

describe('waitForTaskResult cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('輪詢等待期間 signal 中止 -> 立即停止且不再發出下一次請求', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      task: {
        id: 'task-1',
        status: 'processing',
        progress: 25,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const abortController = new AbortController()

    const pending = waitForTaskResult('task-1', {
      intervalMs: 1000,
      signal: abortController.signal,
    })
    const rejection = pending.catch((error: unknown) => error)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    abortController.abort()
    const caught = await rejection
    await vi.advanceTimersByTimeAsync(2000)

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe('AbortError')
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1', {
      method: 'GET',
      cache: 'no-store',
      signal: abortController.signal,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
