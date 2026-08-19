// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { useUploadProjectCharacterImage } from '@/lib/query/mutations/character-base-mutations'
import { useUploadProjectLocationImage } from '@/lib/query/mutations/location-image-mutations'
import { useUploadProjectPropImage } from '@/lib/query/mutations/prop-image-mutations'

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

describe('subject upload mutation invalidation contracts', () => {
  it('角色圖片成功 -> 精確刷新 aggregate 與 characters', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    const { invalidateSpy, wrapper } = createHarness()
    const { result } = renderHook(() => useUploadProjectCharacterImage('project-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        file: new File(['image'], 'character.png', { type: 'image/png' }),
        characterId: 'character-1',
        appearanceId: 'appearance-1',
      })
    })

    expect(invalidateSpy.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.projectAssets.all('project-1'), exact: true },
      { queryKey: queryKeys.projectAssets.characters('project-1'), exact: true },
    ])
  })

  it('場景圖片成功 -> 精確刷新 aggregate 與 locations', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    const { invalidateSpy, wrapper } = createHarness()
    const { result } = renderHook(() => useUploadProjectLocationImage('project-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        file: new File(['image'], 'location.png', { type: 'image/png' }),
        locationId: 'location-1',
      })
    })

    expect(invalidateSpy.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.projectAssets.all('project-1'), exact: true },
      { queryKey: queryKeys.projectAssets.locations('project-1'), exact: true },
    ])
  })

  it('道具圖片成功 -> 精確刷新 aggregate 與 props', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    const { invalidateSpy, wrapper } = createHarness()
    const { result } = renderHook(() => useUploadProjectPropImage('project-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        file: new File(['image'], 'prop.png', { type: 'image/png' }),
        propId: 'prop-1',
      })
    })

    expect(invalidateSpy.mock.calls.map(([options]) => options)).toEqual([
      { queryKey: queryKeys.projectAssets.all('project-1'), exact: true },
      { queryKey: queryKeys.projectAssets.props('project-1'), exact: true },
    ])
  })
})
