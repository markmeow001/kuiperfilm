import type { PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useProjectVoicePresets,
  useUpdateSpeakerVoice,
} from '@/lib/query/mutations/useVoiceMutations'
import type { SystemVoicePreset } from '@/lib/query/mutations/useVoiceMutations'

function wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

describe('voice preset query and mutation transport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('[bind speaker] -> [sends exact episode/speaker/system preset payload without raw source]', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useUpdateSpeakerVoice('project-a'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        episodeId: 'episode-a',
        speaker: 'Ann',
        voicePresetId: 'preset-system',
      })
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/novel-promotion/project-a/speaker-voice')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      episodeId: 'episode-a',
      speaker: 'Ann',
      voicePresetId: 'preset-system',
    })
  })

  it('[load catalog] -> [uses project-scoped read endpoint]', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      voicePresets: [{
        id: 'preset-system', name: 'Ann', description: null, gender: 'female', previewUrl: 'https://signed.example/ann.wav',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useProjectVoicePresets('project-a'), { wrapper })

    let data: SystemVoicePreset[] | undefined
    await act(async () => {
      data = (await result.current.refetch()).data
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/novel-promotion/project-a/voice-presets',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(data?.[0]?.id).toBe('preset-system')
  })
})
