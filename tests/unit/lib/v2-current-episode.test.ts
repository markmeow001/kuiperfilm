/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useProjectDataMock = vi.hoisted(() => vi.fn())
const useRouterMock = vi.hoisted(() => vi.fn())
const usePathnameMock = vi.hoisted(() => vi.fn())
const useSearchParamsMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/query/hooks/useProjectData', () => ({
  useProjectData: useProjectDataMock,
}))
vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}))

import { renderHook, act } from '@testing-library/react'
import { useCurrentEpisode } from '@/app/[locale]/v2/workspace/[projectId]/hooks/useCurrentEpisode'

function searchParamsFrom(query: string) {
  return new URLSearchParams(query)
}

describe('useCurrentEpisode', () => {
  const replace = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    useRouterMock.mockReturnValue({ replace })
    usePathnameMock.mockReturnValue('/en/v2/workspace/proj-1/script')
    useSearchParamsMock.mockReturnValue(searchParamsFrom(''))
  })

  it('returns null id and empty list when project has no episodes', () => {
    useProjectDataMock.mockReturnValue({
      isLoading: false,
      data: { novelPromotionData: { episodes: [] } },
    })
    const { result } = renderHook(() => useCurrentEpisode('proj-1'))
    expect(result.current.episodes).toEqual([])
    expect(result.current.currentEpisodeId).toBeNull()
    expect(result.current.currentEpisode).toBeNull()
  })

  it('falls back to first episode (sorted by episodeNumber) when ?episode is missing', () => {
    useProjectDataMock.mockReturnValue({
      isLoading: false,
      data: {
        novelPromotionData: {
          episodes: [
            { id: 'ep-3', episodeNumber: 3, name: '第 3 集', novelText: 'three' },
            { id: 'ep-1', episodeNumber: 1, name: '第 1 集', novelText: 'one' },
            { id: 'ep-2', episodeNumber: 2, name: '第 2 集', novelText: 'two' },
          ],
        },
      },
    })
    const { result } = renderHook(() => useCurrentEpisode('proj-1'))
    expect(result.current.episodes.map((e) => e.id)).toEqual(['ep-1', 'ep-2', 'ep-3'])
    expect(result.current.currentEpisodeId).toBe('ep-1')
    expect(result.current.currentEpisode?.novelText).toBe('one')
  })

  it('honours ?episode= when it points at a real episode', () => {
    useSearchParamsMock.mockReturnValue(searchParamsFrom('episode=ep-2'))
    useProjectDataMock.mockReturnValue({
      isLoading: false,
      data: {
        novelPromotionData: {
          episodes: [
            { id: 'ep-1', episodeNumber: 1, name: '第 1 集', novelText: 'one' },
            { id: 'ep-2', episodeNumber: 2, name: '第 2 集', novelText: 'two' },
          ],
        },
      },
    })
    const { result } = renderHook(() => useCurrentEpisode('proj-1'))
    expect(result.current.currentEpisodeId).toBe('ep-2')
    expect(result.current.currentEpisode?.novelText).toBe('two')
  })

  it('falls back to first episode when ?episode points at an unknown id', () => {
    useSearchParamsMock.mockReturnValue(searchParamsFrom('episode=ep-ghost'))
    useProjectDataMock.mockReturnValue({
      isLoading: false,
      data: {
        novelPromotionData: {
          episodes: [
            { id: 'ep-1', episodeNumber: 1, name: '第 1 集' },
            { id: 'ep-2', episodeNumber: 2, name: '第 2 集' },
          ],
        },
      },
    })
    const { result } = renderHook(() => useCurrentEpisode('proj-1'))
    expect(result.current.currentEpisodeId).toBe('ep-1')
  })

  it('setCurrentEpisode replaces the URL with ?episode=<id> while preserving other params', () => {
    useSearchParamsMock.mockReturnValue(searchParamsFrom('view=panels'))
    useProjectDataMock.mockReturnValue({
      isLoading: false,
      data: {
        novelPromotionData: {
          episodes: [
            { id: 'ep-1', episodeNumber: 1, name: '第 1 集' },
            { id: 'ep-2', episodeNumber: 2, name: '第 2 集' },
          ],
        },
      },
    })
    const { result } = renderHook(() => useCurrentEpisode('proj-1'))
    act(() => result.current.setCurrentEpisode('ep-2'))
    expect(replace).toHaveBeenCalledTimes(1)
    const [url, opts] = replace.mock.calls[0]
    expect(url).toContain('/en/v2/workspace/proj-1/script')
    expect(url).toContain('view=panels')
    expect(url).toContain('episode=ep-2')
    expect(opts).toEqual({ scroll: false })
  })

  it('synthesises a default name when an episode row has none', () => {
    useProjectDataMock.mockReturnValue({
      isLoading: false,
      data: {
        novelPromotionData: {
          episodes: [{ id: 'ep-x', episodeNumber: 1 }],
        },
      },
    })
    const { result } = renderHook(() => useCurrentEpisode('proj-1'))
    expect(result.current.currentEpisode?.name).toBe('第 1 集')
  })
})
