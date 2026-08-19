// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { useCreateProjectCharacterAppearance } from '@/lib/query/mutations/character-profile-mutations'
import { useCreateCharacterAppearance } from '@/lib/query/mutations/episode-character-binding-mutations'

const fetchMock = vi.fn<typeof fetch>()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { invalidateSpy, wrapper }
}

function mockSuccessfulCreate() {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({
    success: true,
    appearance: { id: 'appearance-2' },
  }), { status: 200 }))
}

const expectedEpisodeInvalidations = [
  { queryKey: queryKeys.projectAssets.all('project-1'), exact: true },
  { queryKey: queryKeys.projectAssets.characters('project-1'), exact: true },
  {
    queryKey: [...queryKeys.tasks.all('project-1'), 'episode-bindings', 'episode-7'],
    exact: true,
  },
]

describe('character appearance create mutations', () => {
  it('V2 指定 episode 建立 -> payload 帶 episodeId 並精確刷新 assets 與該集 binding', async () => {
    mockSuccessfulCreate()
    const { invalidateSpy, wrapper } = createHarness()
    const { result } = renderHook(() => useCreateCharacterAppearance('project-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        characterId: 'character-1',
        episodeId: 'episode-7',
        changeReason: '第七集雨衣',
        description: '黃色雨衣',
      })
    })

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? []
    expect(requestUrl).toBe('/api/novel-promotion/project-1/character/appearance')
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      characterId: 'character-1',
      episodeId: 'episode-7',
      changeReason: '第七集雨衣',
      description: '黃色雨衣',
    })
    expect(invalidateSpy.mock.calls.map(([options]) => options)).toEqual(
      expectedEpisodeInvalidations,
    )
  })

  it('共用建立 mutation 未指定 episode -> 只精確刷新 assets，不刷新任何 binding', async () => {
    mockSuccessfulCreate()
    const { invalidateSpy, wrapper } = createHarness()
    const { result } = renderHook(
      () => useCreateProjectCharacterAppearance('project-1'),
      { wrapper },
    )

    await act(async () => {
      await result.current.mutateAsync({
        characterId: 'character-1',
        changeReason: '宣傳照造型',
        description: '黑色西裝',
      })
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      characterId: 'character-1',
      changeReason: '宣傳照造型',
      description: '黑色西裝',
    })
    expect(invalidateSpy.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.projectAssets.all('project-1'), exact: true },
      { queryKey: queryKeys.projectAssets.characters('project-1'), exact: true },
    ])
  })
})
