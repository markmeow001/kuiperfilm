// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearVoiceGenerationRequestPin,
  pinVoiceGenerationClientRequest,
  readVoiceGenerationRequestPin,
  shouldRetainVoiceGenerationRequestId,
  tryReadVoiceGenerationRequestPin,
  voiceGenerationRequestStorageKey,
  writeVoiceGenerationRequestPin,
} from '@/lib/query/mutations/voice-generation-request'
import { useGenerateProjectVoice } from '@/lib/query/mutations/useVoiceMutations'

const fetchMock = vi.fn<typeof fetch>()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function wrapper({ children }: { children: ReactNode }) {
  return React.createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { mutations: { retry: false } } }) },
    children,
  )
}

function requestBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map(([, init]) => (
    JSON.parse(String(init?.body)) as Record<string, unknown>
  ))
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

async function captureMutationError(operation: () => Promise<unknown>): Promise<unknown> {
  let captured: unknown = null
  await act(async () => {
    try {
      await operation()
    } catch (error) {
      captured = error
    }
  })
  return captured
}

afterEach(() => {
  sessionStorage.clear()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

describe('VoiceLine generation client request identity', () => {
  it('[same logical action retries after unknown outcome] -> [reuses one UUID and exact body]', () => {
    const createId = vi.fn(() => '11111111-1111-4111-8111-111111111111')
    const input = { episodeId: 'episode-a', lineId: 'line-a' }
    const first = pinVoiceGenerationClientRequest(input, null, createId)
    const retry = pinVoiceGenerationClientRequest(input, first.pin, createId)

    expect(retry).toEqual(first)
    expect(retry.body.clientRequestId).toBe('11111111-1111-4111-8111-111111111111')
    expect(createId).toHaveBeenCalledTimes(1)
  })

  it('[batch membership changes] -> [lineIds are part of the pinned action identity and request body]', () => {
    const createId = vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    const first = pinVoiceGenerationClientRequest({
      episodeId: 'episode-a',
      all: true,
      lineIds: ['line-a', 'line-b'],
    }, null, createId)
    const retry = pinVoiceGenerationClientRequest({
      episodeId: 'episode-a',
      all: true,
      lineIds: ['line-a', 'line-b'],
    }, first.pin, createId)
    const changed = pinVoiceGenerationClientRequest({
      episodeId: 'episode-a',
      all: true,
      lineIds: ['line-a', 'line-c'],
    }, first.pin, createId)

    expect(retry).toEqual(first)
    expect(retry.body).toEqual({
      episodeId: 'episode-a',
      all: true,
      lineIds: ['line-a', 'line-b'],
      clientRequestId: '11111111-1111-4111-8111-111111111111',
    })
    expect(changed.pin.clientRequestId).toBe('22222222-2222-4222-8222-222222222222')
    expect(changed.pin.actionFingerprint).not.toBe(first.pin.actionFingerprint)
  })

  it('[unknown outcome then reload] -> [session-scoped storage restores the exact UUID]', () => {
    const storage = memoryStorage()
    const scope = {
      projectId: 'project-a',
      actionFingerprint: JSON.stringify({ episodeId: 'episode-a', lineId: 'line-a' }),
    }
    const pin = {
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      actionFingerprint: scope.actionFingerprint,
    }

    writeVoiceGenerationRequestPin(storage, scope, pin)

    expect(readVoiceGenerationRequestPin(storage, scope)).toEqual(pin)
    expect(JSON.parse(String(storage.getItem(voiceGenerationRequestStorageKey(scope))))).toEqual(pin)
    clearVoiceGenerationRequestPin(storage, scope)
    expect(readVoiceGenerationRequestPin(storage, scope)).toBeNull()
  })

  it('[hook unmounts after network loss then remounts] -> [same logical action reuses persisted UUID]', async () => {
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response({ success: true, async: true, taskId: 'task-a' }))

    const first = renderHook(() => useGenerateProjectVoice('project-a'), { wrapper })
    const variables = { episodeId: 'episode-a', lineId: 'line-a' }
    expect(await captureMutationError(async () => (
      await first.result.current.mutateAsync(variables)
    ))).toBeInstanceOf(TypeError)
    first.unmount()

    const restored = renderHook(() => useGenerateProjectVoice('project-a'), { wrapper })
    await act(async () => {
      await restored.result.current.mutateAsync(variables)
    })

    expect(requestBodies().map((body) => body.clientRequestId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
    ])
    restored.unmount()
  })

  it('[persisted pin is corrupt or from another action] -> [fails closed instead of reusing identity]', () => {
    const storage = memoryStorage()
    const scope = {
      projectId: 'project-a',
      actionFingerprint: JSON.stringify({ episodeId: 'episode-a', lineId: 'line-a' }),
    }
    storage.setItem(voiceGenerationRequestStorageKey(scope), JSON.stringify({
      clientRequestId: 'not-a-uuid',
      actionFingerprint: scope.actionFingerprint,
    }))

    expect(() => readVoiceGenerationRequestPin(storage, scope)).toThrow(
      'Voice generation request identity storage is corrupted',
    )
    expect(tryReadVoiceGenerationRequestPin(storage, scope)).toBeNull()
    expect(storage.getItem(voiceGenerationRequestStorageKey(scope))).toBeNull()
  })

  it('[network then retry succeeds] -> [hook reuses UUID only for retry and next success action gets new UUID]', async () => {
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response({ success: true, async: true, taskId: 'task-a' }))
      .mockResolvedValueOnce(response({ success: true, async: true, taskId: 'task-b' }))

    const { result, unmount } = renderHook(() => useGenerateProjectVoice('project-a'), { wrapper })
    const variables = { episodeId: 'episode-a', lineId: 'line-a' }

    const firstError = await captureMutationError(async () => (
      await result.current.mutateAsync(variables)
    ))
    expect(firstError).toBeInstanceOf(TypeError)
    expect((firstError as Error).message).toBe('Failed to fetch')
    await act(async () => {
      await result.current.mutateAsync(variables)
    })
    await act(async () => {
      await result.current.mutateAsync(variables)
    })

    expect(requestBodies()).toEqual([
      { ...variables, clientRequestId: '11111111-1111-4111-8111-111111111111' },
      { ...variables, clientRequestId: '11111111-1111-4111-8111-111111111111' },
      { ...variables, clientRequestId: '22222222-2222-4222-8222-222222222222' },
    ])
    unmount()
  })

  it.each([408, 429, 502])('[HTTP %s unknown outcome] -> [retry keeps the original UUID]', async (status) => {
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    fetchMock
      .mockResolvedValueOnce(response({ error: { code: 'UPSTREAM' } }, status))
      .mockResolvedValueOnce(response({ success: true, async: true, taskId: 'task-a' }))

    const { result, unmount } = renderHook(() => useGenerateProjectVoice('project-a'), { wrapper })
    const variables = { episodeId: 'episode-a', lineId: 'line-a' }
    const firstError = await captureMutationError(async () => (
      await result.current.mutateAsync(variables)
    ))
    expect(firstError).toBeInstanceOf(Error)
    await act(async () => {
      await result.current.mutateAsync(variables)
    })

    expect(requestBodies().map((body) => body.clientRequestId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
    ])
    unmount()
  })

  it('[2xx malformed/truncated response] -> [rejects local success and reuses UUID]', async () => {
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    fetchMock
      .mockResolvedValueOnce(response({ success: true, async: true }))
      .mockResolvedValueOnce(response({ success: true, async: true, taskId: 'task-a' }))

    const { result, unmount } = renderHook(() => useGenerateProjectVoice('project-a'), { wrapper })
    const variables = { episodeId: 'episode-a', lineId: 'line-a' }
    const firstError = await captureMutationError(async () => (
      await result.current.mutateAsync(variables)
    ))
    expect(firstError).toBeInstanceOf(Error)
    expect((firstError as Error).message).toBe('Invalid voice generation response')
    await act(async () => {
      await result.current.mutateAsync(variables)
    })

    expect(requestBodies().map((body) => body.clientRequestId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
    ])
    unmount()
  })

  it('[deterministic 409] -> [clears UUID so next logical action gets a new one]', async () => {
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    fetchMock
      .mockResolvedValueOnce(response({ error: { code: 'CONFLICT' } }, 409))
      .mockResolvedValueOnce(response({ success: true, async: true, taskId: 'task-a' }))

    const { result, unmount } = renderHook(() => useGenerateProjectVoice('project-a'), { wrapper })
    const variables = { episodeId: 'episode-a', lineId: 'line-a' }
    const firstError = await captureMutationError(async () => (
      await result.current.mutateAsync(variables)
    ))
    expect(firstError).toBeInstanceOf(Error)
    await act(async () => {
      await result.current.mutateAsync(variables)
    })

    expect(requestBodies().map((body) => body.clientRequestId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
    unmount()
  })

  it('[batch action] -> [one UUID is sent once and valid taskIds response clears it]', async () => {
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    fetchMock
      .mockResolvedValueOnce(response({
        success: true,
        async: true,
        taskIds: ['task-a', 'task-b'],
        total: 2,
      }))
      .mockResolvedValueOnce(response({
        success: true,
        async: true,
        taskIds: ['task-c', 'task-d'],
        total: 2,
      }))

    const { result, unmount } = renderHook(() => useGenerateProjectVoice('project-a'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-a', 'line-b'],
      })
    })
    await act(async () => {
      await result.current.mutateAsync({
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-a', 'line-b'],
      })
    })

    expect(requestBodies()).toEqual([
      {
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-a', 'line-b'],
        clientRequestId: '11111111-1111-4111-8111-111111111111',
      },
      {
        episodeId: 'episode-a',
        all: true,
        lineIds: ['line-a', 'line-b'],
        clientRequestId: '22222222-2222-4222-8222-222222222222',
      },
    ])
    unmount()
  })

  it('[status classifier] -> [retains only outcome-unknown response classes]', () => {
    expect(shouldRetainVoiceGenerationRequestId(null)).toBe(true)
    expect(shouldRetainVoiceGenerationRequestId(200)).toBe(true)
    expect(shouldRetainVoiceGenerationRequestId(408)).toBe(true)
    expect(shouldRetainVoiceGenerationRequestId(429)).toBe(true)
    expect(shouldRetainVoiceGenerationRequestId(500)).toBe(true)
    expect(shouldRetainVoiceGenerationRequestId(400)).toBe(false)
    expect(shouldRetainVoiceGenerationRequestId(409)).toBe(false)
  })
})
