// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { useFinalizeProjectCharacterVisual } from '@/lib/query/mutations/character-profile-mutations'

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
  return { queryClient, invalidateSpy, wrapper }
}

describe('useFinalizeProjectCharacterVisual', () => {
  it('success patches and refreshes only the requested project caches', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      alreadyFinal: false,
      character: { id: 'character-1', profileConfirmed: true },
    }), { status: 200 }))
    const { queryClient, invalidateSpy, wrapper } = createHarness()
    queryClient.setQueryData(queryKeys.projectAssets.characters('project-1'), [
      { id: 'character-1', profileConfirmed: false },
      { id: 'character-2', profileConfirmed: false },
    ])
    queryClient.setQueryData(queryKeys.projectAssets.all('project-1'), {
      characters: [{ id: 'character-1', profileConfirmed: false }],
      locations: [{ id: 'location-1' }],
    })
    queryClient.setQueryData(queryKeys.projectAssets.characters('project-2'), [
      { id: 'character-1', profileConfirmed: false },
    ])
    const { result } = renderHook(() => useFinalizeProjectCharacterVisual('project-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        characterId: 'character-1',
        appearanceId: 'appearance-1',
      })
    })

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? []
    expect(requestUrl).toBe('/api/novel-promotion/project-1/character-profile/finalize')
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      characterId: 'character-1',
      appearanceId: 'appearance-1',
    })
    expect(queryClient.getQueryData(queryKeys.projectAssets.characters('project-1'))).toEqual([
      { id: 'character-1', profileConfirmed: true },
      { id: 'character-2', profileConfirmed: false },
    ])
    expect(queryClient.getQueryData(queryKeys.projectAssets.all('project-1'))).toEqual({
      characters: [{ id: 'character-1', profileConfirmed: true }],
      locations: [{ id: 'location-1' }],
    })
    expect(queryClient.getQueryData(queryKeys.projectAssets.characters('project-2'))).toEqual([
      { id: 'character-1', profileConfirmed: false },
    ])
    expect(invalidateSpy.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.projectAssets.characters('project-1'), exact: true },
      { queryKey: queryKeys.projectAssets.all('project-1'), exact: true },
    ])
  })

  it('failure preserves every cache and does not invalidate', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'CHARACTER_VISUAL_NOT_READY' },
    }), { status: 409 }))
    const { queryClient, invalidateSpy, wrapper } = createHarness()
    const before = [{ id: 'character-1', profileConfirmed: false }]
    queryClient.setQueryData(queryKeys.projectAssets.characters('project-1'), before)
    const { result } = renderHook(() => useFinalizeProjectCharacterVisual('project-1'), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync({
        characterId: 'character-1',
        appearanceId: 'appearance-1',
      })).rejects.toThrow()
    })

    expect(queryClient.getQueryData(queryKeys.projectAssets.characters('project-1'))).toEqual(before)
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
