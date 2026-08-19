import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enScript from '../../../messages/en/v2Script.json'
import zhScript from '../../../messages/zh/v2Script.json'

const mocks = vi.hoisted(() => ({
  currentEpisode: vi.fn(),
  projectAccess: vi.fn(),
  setCurrentEpisode: vi.fn(),
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/hooks/useCurrentEpisode', () => ({
  useCurrentEpisode: mocks.currentEpisode,
}))

vi.mock('@/lib/query/hooks/useProjectAccess', () => ({
  useProjectAccess: mocks.projectAccess,
}))

import { V2EpisodeTabBar } from '@/app/[locale]/v2/workspace/[projectId]/V2EpisodeTabBar'

const episodes = [
  { id: 'episode-1', episodeNumber: 1, name: 'Episode 1', novelText: 'One' },
  { id: 'episode-2', episodeNumber: 2, name: 'Episode 2', novelText: 'Two' },
  { id: 'episode-3', episodeNumber: 3, name: 'Episode 3', novelText: 'Three' },
]

let activeEpisodeId = 'episode-1'

function renderBar(locale: 'en' | 'zh' = 'en', tone: 'darkroom' | 'paper' = 'paper') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const messages = locale === 'en' ? enScript : zhScript
  const result = render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale={locale} messages={{ v2Script: messages }}>
        <V2EpisodeTabBar
          projectId="project-1"
          locale={locale}
          projectName="Project One"
          tone={tone}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  )
  return { ...result, invalidate, queryClient }
}

describe('V2EpisodeTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeEpisodeId = 'episode-1'
    mocks.setCurrentEpisode.mockImplementation((episodeId: string) => {
      activeEpisodeId = episodeId
    })
    mocks.currentEpisode.mockImplementation(() => ({
      episodes,
      currentEpisodeId: activeEpisodeId,
      currentEpisode: episodes.find((episode) => episode.id === activeEpisodeId) ?? null,
      setCurrentEpisode: mocks.setCurrentEpisode,
    }))
    mocks.projectAccess.mockReturnValue({
      allowed: true,
      role: 'editor',
      canEdit: true,
      canView: true,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('[three episodes] -> exposes roving tabs and Arrow/Home/End move selection and focus', () => {
    const { rerender } = renderBar()
    expect(screen.getByRole('tablist')).toBeInTheDocument()

    let tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
    expect(tabs[0]).toHaveClass('min-h-11')

    tabs[0].focus()
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(mocks.setCurrentEpisode).toHaveBeenLastCalledWith('episode-2')
    expect(tabs[1]).toHaveFocus()
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={{ v2Script: enScript }}>
          <V2EpisodeTabBar projectId="project-1" locale="en" projectName="Project One" tone="paper" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    )

    tabs = screen.getAllByRole('tab')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    tabs[1].focus()
    fireEvent.keyDown(tabs[1], { key: 'Home' })
    expect(mocks.setCurrentEpisode).toHaveBeenLastCalledWith('episode-1')
    expect(tabs[0]).toHaveFocus()

    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(mocks.setCurrentEpisode).toHaveBeenLastCalledWith('episode-3')
    expect(tabs[2]).toHaveFocus()
  })

  it('[editor presses F2] -> opens an accessible rename field and PATCHes the exact name', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    const { invalidate } = renderBar()

    const firstTab = screen.getAllByRole('tab')[0]
    firstTab.focus()
    fireEvent.keyDown(firstTab, { key: 'F2' })

    const rename = screen.getByRole('textbox', { name: 'Rename Episode 1' })
    expect(rename).toHaveValue('Episode 1')
    expect(rename).toHaveClass('min-h-11')
    fireEvent.change(rename, { target: { value: 'Opening' } })
    fireEvent.keyDown(rename, { key: 'Enter' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/novel-promotion/project-1/episodes/episode-1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Opening' }),
      },
    ))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project-data', 'project-1'] })
    await waitFor(() => expect(screen.getAllByRole('tab')[0]).toHaveFocus())
  })

  it('[F2 then Escape] -> closes rename and returns focus to the originating tab', async () => {
    renderBar()
    const firstTab = screen.getAllByRole('tab')[0]
    firstTab.focus()
    fireEvent.keyDown(firstTab, { key: 'F2' })
    const rename = screen.getByRole('textbox', { name: 'Rename Episode 1' })

    fireEvent.keyDown(rename, { key: 'Escape' })

    await waitFor(() => expect(screen.getAllByRole('tab')[0]).toHaveFocus())
    expect(screen.queryByRole('textbox', { name: 'Rename Episode 1' })).not.toBeInTheDocument()
  })

  it('[viewer] -> can select episodes but cannot add, rename, or delete them', () => {
    mocks.projectAccess.mockReturnValue({
      allowed: true,
      role: 'viewer',
      canEdit: false,
      canView: true,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    renderBar()

    expect(screen.queryByRole('button', { name: 'New episode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Episode 1' })).not.toBeInTheDocument()

    const firstTab = screen.getAllByRole('tab')[0]
    fireEvent.doubleClick(firstTab)
    fireEvent.keyDown(firstTab, { key: 'F2' })
    expect(screen.queryByRole('textbox', { name: 'Rename Episode 1' })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('tab')[1])
    expect(mocks.setCurrentEpisode).toHaveBeenCalledWith('episode-2')
  })

  it('[access revoked while renaming] -> closes the mutation field immediately', () => {
    const view = renderBar()
    const firstTab = screen.getAllByRole('tab')[0]
    fireEvent.keyDown(firstTab, { key: 'F2' })
    expect(screen.getByRole('textbox', { name: 'Rename Episode 1' })).toBeInTheDocument()

    mocks.projectAccess.mockReturnValue({
      allowed: true,
      role: 'viewer',
      canEdit: false,
      canView: true,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <NextIntlClientProvider locale="en" messages={{ v2Script: enScript }}>
          <V2EpisodeTabBar projectId="project-1" locale="en" projectName="Project One" tone="paper" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('textbox', { name: 'Rename Episode 1' })).not.toBeInTheDocument()
  })

  it('[darkroom on mobile] -> home link is 44px and hidden until the small breakpoint', () => {
    renderBar('en', 'darkroom')
    const home = screen.getByRole('link', { name: /Project One/ })
    expect(home).toHaveClass('min-h-11')
    expect(home).toHaveClass('hidden')
    expect(home).toHaveClass('sm:flex')
  })

  it('[add request fails] -> shows localized stable error without leaking the response body', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response('PRIVATE_SERVER_DETAIL', { status: 400 }))
    renderBar('zh')

    const add = screen.getByRole('button', { name: '新建集數' })
    expect(add).toHaveClass('min-h-11')
    fireEvent.click(add)

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('無法建立集數。')
    expect(error).not.toHaveTextContent('PRIVATE_SERVER_DETAIL')
    expect(screen.getByRole('button', { name: '關閉錯誤訊息' })).toHaveClass('min-h-11')
  })

  it('[add returns HTTP 5xx] -> treats the create outcome as unknown and blocks another POST', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response('server failed after create', { status: 503 }))
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'New episode' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Adding again is blocked')
    expect(screen.getByRole('button', { name: 'New episode' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refresh episodes' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('[add response is lost] -> blocks blind POST retry and offers episode refresh', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockRejectedValueOnce(new TypeError('response lost'))
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'New episode' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Adding again is blocked')
    expect(screen.getByRole('button', { name: 'New episode' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refresh episodes' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('[add returns malformed 2xx JSON] -> treats the committed outcome as unknown and never reposts', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response('{not-json', { status: 200 }))
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'New episode' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Adding again is blocked')
    expect(screen.getByRole('button', { name: 'New episode' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh episodes' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'New episode' })).toBeDisabled()
  })
})
