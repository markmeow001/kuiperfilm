// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { useCreateProjectCharacter } from '@/lib/query/mutations/character-profile-mutations'

const fetchMock = vi.fn<typeof fetch>()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('useCreateProjectCharacter create contract', () => {
  it('含 episode/introduction 建立成功 -> 送出精確 payload 並只刷新受影響 keys', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      character: {
        id: 'character-1',
        appearances: [{ id: 'appearance-1' }],
      },
    }), { status: 200 }))
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(() => useCreateProjectCharacter('project-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        name: '林醫師',
        description: '',
        introduction: '冷靜的急診醫師',
        episodeId: 'episode-1',
      })
    })

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? []
    expect(requestUrl).toBe('/api/novel-promotion/project-1/character')
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      name: '林醫師',
      description: '',
      introduction: '冷靜的急診醫師',
      episodeId: 'episode-1',
    })
    expect(invalidateSpy.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.projectAssets.all('project-1'), exact: true },
      { queryKey: queryKeys.projectAssets.characters('project-1'), exact: true },
      {
        queryKey: [...queryKeys.tasks.all('project-1'), 'episode-bindings', 'episode-1'],
        exact: true,
      },
    ])
  })
})
