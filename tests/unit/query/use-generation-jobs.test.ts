// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVE_GENERATION_JOBS_REFETCH_MS,
  generationJobsRefetchInterval,
  IDLE_GENERATION_JOBS_REFETCH_MS,
  useGenerationJobs,
} from '@/lib/query/hooks/useGenerationJobs'
import type { JobView } from '@/lib/task/job-view'

const globalWithFetch = globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  return React.createElement(QueryClientProvider, { client }, children)
}

function job(id: string): JobView {
  return {
    id,
    type: 'video_panel',
    title: 'Video Panel',
    typeLabel: 'Video Panel',
    targetType: 'StoryboardPanel',
    targetId: 'panel-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    status: 'completed',
    progress: 100,
    model: 'video-model',
    cost: { estimated: 1, actual: 0.8, currency: 'CNY' },
    billingStatus: 'charged',
    refund: { status: 'not_refunded', amount: null },
    error: null,
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:01:00.000Z',
    queuedAt: '2026-08-08T10:00:00.000Z',
    startedAt: '2026-08-08T10:00:10.000Z',
    finishedAt: '2026-08-08T10:01:00.000Z',
    durationMs: 50_000,
    attempt: 1,
    maxAttempts: 3,
    stageLabel: 'Completed',
    canCancel: false,
  }
}

beforeEach(() => {
  globalWithFetch.fetch = vi.fn()
})

describe('useGenerationJobs', () => {
  it('active jobs use fast polling while an idle center keeps a slower refresh', () => {
    expect(generationJobsRefetchInterval(undefined)).toBe(IDLE_GENERATION_JOBS_REFETCH_MS)
    expect(generationJobsRefetchInterval([{ tasks: [job('done')], nextCursor: null }]))
      .toBe(IDLE_GENERATION_JOBS_REFETCH_MS)
    expect(generationJobsRefetchInterval([{
      tasks: [{ ...job('active'), status: 'running', canCancel: true }],
      nextCursor: null,
    }])).toBe(ACTIVE_GENERATION_JOBS_REFETCH_MS)
  })

  it('带筛选与下一页 -> 请求 summary API 并传递 cursor', async () => {
    globalWithFetch.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tasks: [job('task-1')], nextCursor: 'task-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tasks: [job('task-2')], nextCursor: null }),
      })

    const { result } = renderHook(() => useGenerationJobs({
      projectId: 'project-1',
      episodeId: 'episode-1',
      statuses: ['cancelled', 'active'],
      types: ['video_panel', 'image_panel'],
      limit: 20,
    }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const firstUrl = String(globalWithFetch.fetch.mock.calls[0]?.[0])
    const firstSearch = new URL(firstUrl, 'http://localhost').searchParams
    expect(firstSearch.get('scope')).toBe('summary')
    expect(firstSearch.get('projectId')).toBe('project-1')
    expect(firstSearch.get('episodeId')).toBe('episode-1')
    expect(firstSearch.getAll('jobStatus')).toEqual(['active', 'cancelled'])
    expect(firstSearch.getAll('type')).toEqual(['image_panel', 'video_panel'])
    expect(firstSearch.get('limit')).toBe('20')

    let nextPageIds: string[] = []
    await act(async () => {
      const nextResult = await result.current.fetchNextPage()
      nextPageIds = nextResult.data?.pages
        .flatMap((page) => page.tasks)
        .map((item) => item.id) || []
    })
    const secondUrl = String(globalWithFetch.fetch.mock.calls[1]?.[0])
    expect(new URL(secondUrl, 'http://localhost').searchParams.get('cursor')).toBe('task-1')
    expect(nextPageIds).toEqual(['task-1', 'task-2'])
  })

  it('enabled=false -> 不送出列表请求', () => {
    renderHook(() => useGenerationJobs({ enabled: false }), { wrapper })
    expect(globalWithFetch.fetch).not.toHaveBeenCalled()
  })
})
