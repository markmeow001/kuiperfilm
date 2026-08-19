// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoGroupMultiShot } from '@/lib/query/mutations/auto-group-multi-shot-mutation'
import type { GenerationJobsPage } from '@/lib/query/hooks/useGenerationJobs'
import { queryKeys } from '@/lib/query/keys'
import type { JobStatus, JobView } from '@/lib/task/job-view'

const globalWithFetch = globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }
const EN_OPTIONS = {
  canCancelTasks: true,
  messages: {
    submitFailed: 'Auto-group request failed',
    outcomeUnknown: 'Connection lost while submitting. Checking the task queue…',
    invalidResponse: 'The server returned an invalid task response. Checking the task queue…',
    cancelFailed: 'Cancel request failed',
  },
} as const

function job(status: JobStatus, overrides: Partial<JobView> = {}): JobView {
  const active = status === 'queued' || status === 'running'
  return {
    id: 'task-auto-group-1',
    type: 'auto_group_multi_shot',
    title: 'Auto Group Multi Shot',
    typeLabel: 'Auto Group Multi Shot',
    targetType: 'NovelPromotionEpisode',
    targetId: 'episode-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    status,
    progress: status === 'completed' ? 100 : status === 'running' ? 45 : 0,
    model: 'openrouter::gpt-4o',
    cost: { estimated: 0.1, actual: null, currency: 'CNY' },
    billingStatus: 'reserved',
    refund: { status: 'not_refunded', amount: null },
    error: status === 'failed'
      ? {
          code: 'INTERNAL_ERROR',
          message: 'grouping failed',
          httpStatus: 500,
          retryable: true,
          category: 'SYSTEM',
          userMessageKey: 'errors.INTERNAL_ERROR',
          details: null,
        }
      : null,
    createdAt: '2026-08-10T10:00:00.000Z',
    updatedAt: '2026-08-10T10:01:00.000Z',
    queuedAt: '2026-08-10T10:00:00.000Z',
    startedAt: status === 'queued' ? null : '2026-08-10T10:00:10.000Z',
    finishedAt: active ? null : '2026-08-10T10:01:00.000Z',
    durationMs: active ? null : 50_000,
    attempt: 1,
    maxAttempts: 1,
    stageLabel: status,
    canCancel: active,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { queryClient, wrapper }
}

function jobsKey(episodeId = 'episode-1') {
  return queryKeys.generationJobs.list({
    projectId: 'project-1',
    episodeId,
    statuses: [],
    types: ['auto_group_multi_shot'],
    limit: 10,
  })
}

beforeEach(() => {
  globalWithFetch.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      return jsonResponse({
        success: true,
        async: true,
        taskId: 'task-auto-group-1',
        status: 'queued',
        deduped: false,
      })
    }
    if (url.startsWith('/api/tasks?')) {
      return jsonResponse({ tasks: [], nextCursor: null })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
})

describe('useAutoGroupMultiShot durable lifecycle', () => {
  it('HTTP 200 is only submitted; UI stays pending until the polled Task completes', async () => {
    const { queryClient, wrapper } = createHarness()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result, unmount } = renderHook(
      () => useAutoGroupMultiShot('project-1', 'episode-1', EN_OPTIONS),
      { wrapper },
    )

    await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled())
    await act(async () => {
      await result.current.mutateAsync({ episodeId: 'episode-1' })
    })

    expect(result.current.taskId).toBe('task-auto-group-1')
    expect(result.current.status).toBe('queued')
    expect(result.current.isPending).toBe(true)

    act(() => {
      queryClient.setQueryData<InfiniteData<GenerationJobsPage>>(jobsKey(), {
        pages: [{ tasks: [job('completed')], nextCursor: null }],
        pageParams: [null],
      })
    })

    await waitFor(() => expect(result.current.status).toBe('completed'))
    expect(result.current.isPending).toBe(false)
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.storyboards.all('episode-1'),
      })
    })
    const storyboardInvalidations = () => invalidateSpy.mock.calls.filter(
      ([invalidateOptions]) => JSON.stringify(invalidateOptions?.queryKey) === JSON.stringify(
        queryKeys.storyboards.all('episode-1'),
      ),
    )
    expect(storyboardInvalidations()).toHaveLength(1)

    act(() => {
      queryClient.setQueryData<InfiniteData<GenerationJobsPage>>(jobsKey(), {
        pages: [{
          tasks: [job('completed', { updatedAt: '2026-08-10T10:02:00.000Z' })],
          nextCursor: null,
        }],
        pageParams: [null],
      })
    })
    await waitFor(() => expect(result.current.progress).toBe(100))
    expect(storyboardInvalidations()).toHaveLength(1)
    unmount()
  })

  it('active polled Task can be cancelled through the shared DELETE lifecycle', async () => {
    let cancelled = false
    globalWithFetch.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'DELETE') {
        cancelled = true
        return jsonResponse({ success: true, cancelled: true })
      }
      if (url.startsWith('/api/tasks?')) {
        return jsonResponse({
          tasks: [job(cancelled ? 'cancelled' : 'running')],
          nextCursor: null,
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { wrapper } = createHarness()
    const { result, unmount } = renderHook(
      () => useAutoGroupMultiShot('project-1', 'episode-1', EN_OPTIONS),
      { wrapper },
    )

    await waitFor(() => expect(result.current.status).toBe('running'))
    expect(result.current.canCancel).toBe(true)

    await act(async () => {
      await result.current.cancelCurrent()
    })

    expect(globalWithFetch.fetch).toHaveBeenCalledWith(
      '/api/tasks/task-auto-group-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    await waitFor(() => expect(result.current.status).toBe('cancelled'))
    expect(result.current.isPending).toBe(false)
    unmount()
  })

  it('viewer cannot issue DELETE even when the polled Task is active', async () => {
    globalWithFetch.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/tasks?')) {
        return jsonResponse({ tasks: [job('running')], nextCursor: null })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { wrapper } = createHarness()
    const { result, unmount } = renderHook(
      () => useAutoGroupMultiShot('project-1', 'episode-1', {
        ...EN_OPTIONS,
        canCancelTasks: false,
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.status).toBe('running'))
    expect(result.current.canCancel).toBe(false)
    await act(async () => {
      await result.current.cancelCurrent()
    })
    expect(globalWithFetch.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    unmount()
  })

  it('lost POST response reconciles to the durable Task and suppresses blind resubmission', async () => {
    globalWithFetch.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') throw new TypeError('Failed to fetch')
      if (url.startsWith('/api/tasks?')) {
        return jsonResponse({ tasks: [], nextCursor: null })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { queryClient, wrapper } = createHarness()
    const { result, unmount } = renderHook(
      () => useAutoGroupMultiShot('project-1', 'episode-1', EN_OPTIONS),
      { wrapper },
    )

    await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled())
    await act(async () => {
      await expect(result.current.mutateAsync({ episodeId: 'episode-1' })).rejects.toThrow(
        EN_OPTIONS.messages.outcomeUnknown,
      )
    })
    expect(result.current.status).toBe('reconciling')
    expect(result.current.isPending).toBe(true)
    expect(result.current.error?.message).toBe(EN_OPTIONS.messages.outcomeUnknown)

    act(() => {
      result.current.mutate({ episodeId: 'episode-1' })
    })
    expect(globalWithFetch.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)

    act(() => {
      queryClient.setQueryData<InfiniteData<GenerationJobsPage>>(jobsKey(), {
        pages: [{ tasks: [job('running')], nextCursor: null }],
        pageParams: [null],
      })
    })
    await waitFor(() => expect(result.current.status).toBe('running'))
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBeNull()
    unmount()
  })

  it('HTTP 5xx is outcome-unknown and reconciles instead of claiming rejection', async () => {
    globalWithFetch.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        return {
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError('not json')
          },
        } as unknown as Response
      }
      if (url.startsWith('/api/tasks?')) {
        return jsonResponse({ tasks: [], nextCursor: null })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { wrapper } = createHarness()
    const { result, unmount } = renderHook(
      () => useAutoGroupMultiShot('project-1', 'episode-1', EN_OPTIONS),
      { wrapper },
    )

    await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled())
    await act(async () => {
      await expect(result.current.mutateAsync({ episodeId: 'episode-1' })).rejects.toThrow(
        EN_OPTIONS.messages.outcomeUnknown,
      )
    })
    expect(result.current.status).toBe('reconciling')
    expect(result.current.isPending).toBe(true)
    expect(result.current.isError).toBe(false)
    expect(result.current.error?.message).toBe(EN_OPTIONS.messages.outcomeUnknown)
    unmount()
  })

  it('HTTP 408 is outcome-unknown because the server may have accepted the Task', async () => {
    globalWithFetch.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return jsonResponse({}, 408)
      if (url.startsWith('/api/tasks?')) {
        return jsonResponse({ tasks: [], nextCursor: null })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { wrapper } = createHarness()
    const { result, unmount } = renderHook(
      () => useAutoGroupMultiShot('project-1', 'episode-1', EN_OPTIONS),
      { wrapper },
    )

    await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled())
    await act(async () => {
      await expect(result.current.mutateAsync({ episodeId: 'episode-1' })).rejects.toThrow(
        EN_OPTIONS.messages.outcomeUnknown,
      )
    })
    expect(result.current.status).toBe('reconciling')
    expect(result.current.isPending).toBe(true)
    unmount()
  })

  it('a definitive HTTP 409 rejection does not enter reconciliation', async () => {
    globalWithFetch.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return jsonResponse({}, 409)
      if (url.startsWith('/api/tasks?')) {
        return jsonResponse({ tasks: [], nextCursor: null })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { wrapper } = createHarness()
    const { result, unmount } = renderHook(
      () => useAutoGroupMultiShot('project-1', 'episode-1', EN_OPTIONS),
      { wrapper },
    )

    await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled())
    await act(async () => {
      await expect(result.current.mutateAsync({ episodeId: 'episode-1' })).rejects.toThrow(
        EN_OPTIONS.messages.submitFailed,
      )
    })
    expect(result.current.status).not.toBe('reconciling')
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(true)
    unmount()
  })

  it('preserves episode A reconciliation when episode B submits and rejects', async () => {
    globalWithFetch.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST' && url.includes('/episode-1/')) {
        throw new TypeError('Failed to fetch')
      }
      if (init?.method === 'POST' && url.includes('/episode-2/')) {
        return jsonResponse({}, 409)
      }
      if (url.startsWith('/api/tasks?')) {
        return jsonResponse({ tasks: [], nextCursor: null })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { wrapper } = createHarness()
    const { result, rerender, unmount } = renderHook(
      ({ episodeId }: { episodeId: string }) => (
        useAutoGroupMultiShot('project-1', episodeId, EN_OPTIONS)
      ),
      { initialProps: { episodeId: 'episode-1' }, wrapper },
    )

    await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled())
    await act(async () => {
      await expect(result.current.mutateAsync({ episodeId: 'episode-1' })).rejects.toThrow(
        EN_OPTIONS.messages.outcomeUnknown,
      )
    })
    expect(result.current.status).toBe('reconciling')

    rerender({ episodeId: 'episode-2' })
    await act(async () => {
      await expect(result.current.mutateAsync({ episodeId: 'episode-2' })).rejects.toThrow(
        EN_OPTIONS.messages.submitFailed,
      )
    })

    rerender({ episodeId: 'episode-1' })
    await waitFor(() => expect(result.current.status).toBe('reconciling'))
    act(() => {
      result.current.mutate({ episodeId: 'episode-1' })
    })
    expect(globalWithFetch.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2)
    unmount()
  })

  it.each(['cancelled', 'completed'] as const)(
    'durable %s wins after the cancellation response is lost',
    async (terminalStatus) => {
      let deleteWasAccepted = false
      globalWithFetch.fetch.mockImplementation(async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = String(input)
        if (init?.method === 'DELETE') {
          deleteWasAccepted = true
          throw new TypeError('Failed to fetch')
        }
        if (url.startsWith('/api/tasks?')) {
          return jsonResponse({
            tasks: [job(deleteWasAccepted ? terminalStatus : 'running')],
            nextCursor: null,
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      const { wrapper } = createHarness()
      const { result, unmount } = renderHook(
        () => useAutoGroupMultiShot('project-1', 'episode-1', EN_OPTIONS),
        { wrapper },
      )

      await waitFor(() => expect(result.current.status).toBe('running'))
      await act(async () => {
        await expect(result.current.cancelCurrent()).rejects.toThrow(
          EN_OPTIONS.messages.cancelFailed,
        )
      })

      await waitFor(() => expect(result.current.status).toBe(terminalStatus))
      expect(result.current.isError).toBe(false)
      expect(result.current.error).toBeNull()
      unmount()
    },
  )

  it('non-JSON HTTP 200 is not treated as completion and uses the English reconciliation message', async () => {
    globalWithFetch.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('not json')
          },
        } as unknown as Response
      }
      if (url.startsWith('/api/tasks?')) {
        return jsonResponse({ tasks: [], nextCursor: null })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { wrapper } = createHarness()
    const { result, unmount } = renderHook(
      () => useAutoGroupMultiShot('project-1', 'episode-1', EN_OPTIONS),
      { wrapper },
    )

    await waitFor(() => expect(globalWithFetch.fetch).toHaveBeenCalled())
    await act(async () => {
      await expect(result.current.mutateAsync({ episodeId: 'episode-1' })).rejects.toThrow(
        EN_OPTIONS.messages.invalidResponse,
      )
    })
    expect(result.current.status).toBe('reconciling')
    expect(result.current.isPending).toBe(true)
    expect(result.current.error?.message).toBe(EN_OPTIONS.messages.invalidResponse)
    unmount()
  })

  it('worker failure is surfaced as a mutation-compatible error payload', async () => {
    globalWithFetch.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/tasks?')) {
        return jsonResponse({ tasks: [job('failed')], nextCursor: null })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { wrapper } = createHarness()
    const { result, unmount } = renderHook(
      () => useAutoGroupMultiShot('project-1', 'episode-1', EN_OPTIONS),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.status).toBe('failed')
    expect(result.current.error).toMatchObject({
      message: 'grouping failed',
      payload: {
        error: { code: 'INTERNAL_ERROR', message: 'grouping failed' },
      },
    })
    unmount()
  })
})
