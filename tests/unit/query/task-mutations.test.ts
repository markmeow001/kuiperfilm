// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCancelGenerationJob } from '@/lib/query/mutations/task-mutations'

const globalWithFetch = globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }

beforeEach(() => {
  globalWithFetch.fetch = vi.fn()
})

describe('task mutations', () => {
  it('uses the caller-provided localized fallback when DELETE transport fails', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    globalWithFetch.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(
      () => useCancelGenerationJob('project-1', 'Cancel request failed'),
      { wrapper },
    )

    await act(async () => {
      await expect(result.current.mutateAsync('task-1')).rejects.toThrow('Cancel request failed')
    })
  })

  it('取消生成任务成功 -> 使用 DELETE 并刷新 Job Center 与项目任务缓存', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    globalWithFetch.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, cancelled: true }),
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(() => useCancelGenerationJob('project-1'), { wrapper })

    await act(async () => {
      const response = await result.current.mutateAsync('task/unsafe-id')
      expect(response).toEqual({ success: true, cancelled: true })
    })

    expect(globalWithFetch.fetch).toHaveBeenCalledWith(
      '/api/tasks/task%2Funsafe-id',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['generation-jobs'] })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['tasks', 'project-1'],
      exact: false,
    })
  })

  it('個人任務中心取消真實專案任務 -> 依回應中的 projectId 刷新專案快取', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    globalWithFetch.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        cancelled: true,
        task: { projectId: 'shared-project' },
      }),
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(() => useCancelGenerationJob(null), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('task-1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['tasks', 'shared-project'],
      exact: false,
    })
  })
})
