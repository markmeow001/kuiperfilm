import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVisualDevelopmentCharacterAutosave } from '@/app/[locale]/visual-development/useVisualDevelopmentProjectState'
import { EMPTY_CASTING_FORM, EMPTY_FACE_FORM } from '@/app/[locale]/visual-development/visual-development-client-state'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('useVisualDevelopmentCharacterAutosave', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('序列化重疊 autosave，下一筆使用前一筆回傳的新 revision', async () => {
    vi.useFakeTimers()
    const first = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    const second = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetchMock)
    const revisionRef = { current: '2026-07-31T00:00:00.000Z' }
    const initialForm = {
      ...EMPTY_CASTING_FORM,
      characterCode: 'SINO',
      characterName: '絲諾',
      castingBrief: { ...EMPTY_CASTING_FORM.castingBrief, canonRationale: 'v1' },
    }

    const { rerender } = renderHook(
      ({ form }) => useVisualDevelopmentCharacterAutosave({
        projectId: 'project-1',
        characterCode: form.characterCode,
        form,
        faceForm: EMPTY_FACE_FORM,
        isLoading: false,
        revisionRef,
      }),
      { initialProps: { form: initialForm } },
    )

    await act(async () => { vi.advanceTimersByTime(900); await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender({
      form: {
        ...initialForm,
        castingBrief: { ...initialForm.castingBrief, canonRationale: 'v2' },
      },
    })
    await act(async () => { vi.advanceTimersByTime(900); await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    first.resolve({
      ok: true,
      json: async () => ({ data: { character: { updatedAt: '2026-07-31T00:00:01.000Z' } } }),
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      expectedUpdatedAt: string
      castingBrief: { canonRationale: string }
    }
    expect(secondRequest.expectedUpdatedAt).toBe('2026-07-31T00:00:01.000Z')
    expect(secondRequest.castingBrief.canonRationale).toBe('v2')

    second.resolve({
      ok: true,
      json: async () => ({ data: { character: { updatedAt: '2026-07-31T00:00:02.000Z' } } }),
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(revisionRef.current).toBe('2026-07-31T00:00:02.000Z')
  })

  it('切換角色後忽略舊角色延遲回應，不污染新角色 revision', async () => {
    vi.useFakeTimers()
    const oldCharacter = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    const newCharacter = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(oldCharacter.promise)
      .mockReturnValueOnce(newCharacter.promise)
    vi.stubGlobal('fetch', fetchMock)
    const revisionRef = { current: 'revision-a' }
    const formA = { ...EMPTY_CASTING_FORM, characterCode: 'CHAR-A', characterName: 'A' }

    const { rerender } = renderHook(
      ({ form, characterCode }) => useVisualDevelopmentCharacterAutosave({
        projectId: 'project-1', characterCode, form, faceForm: EMPTY_FACE_FORM,
        isLoading: false, revisionRef,
      }),
      { initialProps: { form: formA, characterCode: 'CHAR-A' } },
    )
    await act(async () => { vi.advanceTimersByTime(900); await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    revisionRef.current = 'revision-b'
    rerender({
      characterCode: 'CHAR-B',
      form: { ...EMPTY_CASTING_FORM, characterCode: 'CHAR-B', characterName: 'B' },
    })
    await act(async () => { vi.advanceTimersByTime(900); await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    oldCharacter.resolve({
      ok: true,
      json: async () => ({ data: { character: { updatedAt: 'revision-a2' } } }),
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(revisionRef.current).toBe('revision-b')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const newRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { expectedUpdatedAt: string }
    expect(newRequest.expectedUpdatedAt).toBe('revision-b')

    newCharacter.resolve({
      ok: true,
      json: async () => ({ data: { character: { updatedAt: 'revision-b2' } } }),
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(revisionRef.current).toBe('revision-b2')
  })
})
