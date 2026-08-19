// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { useUpdateProjectConfig } from '@/lib/query/mutations/useProjectConfigMutations'
import type { Project } from '@/types/project'

const fetchMock = vi.fn<typeof fetch>()

function buildProject(videoRatio: string): Project {
  return {
    id: 'project-1',
    name: 'Settings contract project',
    novelPromotionData: {
      videoRatio,
      targetDuration: 60,
      analysisModel: 'analysis-model-1',
    },
  } as unknown as Project
}

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response
}

function createHarness(project: Project) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const projectQueryKey = queryKeys.projectData('project-1')
  queryClient.setQueryData(projectQueryKey, project)
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)

  return { projectQueryKey, queryClient, wrapper }
}

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('useUpdateProjectConfig optimistic cache contract', () => {
  it('PATCH 失敗 -> 先樂觀更新，再還原完整舊專案設定', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const previousProject = buildProject('9:16')
    const { projectQueryKey, queryClient, wrapper } = createHarness(previousProject)
    let resolveRequest: ((response: Response) => void) | undefined
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => {
      resolveRequest = resolve
    }))
    const { result } = renderHook(() => useUpdateProjectConfig('project-1'), { wrapper })

    let mutationPromise: Promise<unknown> = Promise.resolve()
    act(() => {
      mutationPromise = result.current.mutateAsync({ key: 'videoRatio', value: '16:9' })
    })

    await waitFor(() => {
      const optimisticProject = queryClient.getQueryData<Project>(projectQueryKey)
      expect(optimisticProject?.novelPromotionData?.videoRatio).toBe('16:9')
      expect(optimisticProject?.novelPromotionData?.targetDuration).toBe(60)
    })

    const rejection = expect(mutationPromise).rejects.toThrow('ratio update rejected')
    resolveRequest?.(jsonResponse(422, { error: 'ratio update rejected' }))
    await act(async () => {
      await rejection
    })

    expect(queryClient.getQueryData<Project>(projectQueryKey)).toEqual(previousProject)
  })

  it('PATCH 成功 -> 保留樂觀更新、送出精確 payload 並刷新專案查詢', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const { projectQueryKey, queryClient, wrapper } = createHarness(buildProject('9:16'))
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true }))
    const { result } = renderHook(() => useUpdateProjectConfig('project-1'), { wrapper })

    await act(async () => {
      const response = await result.current.mutateAsync({ key: 'videoRatio', value: '16:9' })
      expect(response).toEqual({ success: true })
    })

    const updatedProject = queryClient.getQueryData<Project>(projectQueryKey)
    expect(updatedProject?.novelPromotionData?.videoRatio).toBe('16:9')
    expect(updatedProject?.novelPromotionData?.targetDuration).toBe(60)

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? []
    expect(requestUrl).toBe('/api/novel-promotion/project-1')
    expect(requestInit?.method).toBe('PATCH')
    expect(JSON.parse(String(requestInit?.body))).toEqual({ videoRatio: '16:9' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: projectQueryKey })
  })
})
