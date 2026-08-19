// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCreateProjectVoiceLine } from '@/lib/query/mutations/useVoiceMutations'

const fetchMock = vi.fn<typeof fetch>()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function wrapper({ children }: { children: ReactNode }) {
  return React.createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { mutations: { retry: false } } }) },
    children,
  )
}

describe('project voice line create mutation contract', () => {
  it('[legacy caller omits request key] -> [adds one request key before POST]', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      voiceLine: { id: 'line-1' },
    }), { status: 200 }))
    const { result } = renderHook(() => useCreateProjectVoiceLine('project-A'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        episodeId: 'episode-A1',
        content: 'Hello',
        speaker: 'Ann',
      })
    })

    const [, init] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      episodeId: 'episode-A1',
      content: 'Hello',
      speaker: 'Ann',
    })
    expect(body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('[HTTP 200 response is malformed] -> [rejects instead of reporting local success]', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
    const { result } = renderHook(() => useCreateProjectVoiceLine('project-A'), { wrapper })

    await expect(act(async () => {
      await result.current.mutateAsync({
        episodeId: 'episode-A1',
        content: 'Hello',
        speaker: 'Ann',
        clientRequestId: '11111111-1111-4111-8111-111111111111',
      })
    })).rejects.toThrow('Invalid voice line response')
  })
})
