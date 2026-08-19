import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  projectData: vi.fn(),
  projectAccess: vi.fn(),
  currentEpisode: vi.fn(),
  push: vi.fn(),
  accessRefetch: vi.fn(),
  invalidateQueries: vi.fn(),
  bulkCanEdit: true,
}))

vi.mock('@/lib/query/hooks/useProjectData', () => ({
  useProjectData: mocks.projectData,
}))

vi.mock('@/lib/query/hooks/useProjectAccess', () => ({
  useProjectAccess: mocks.projectAccess,
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/hooks/useCurrentEpisode', () => ({
  useCurrentEpisode: mocks.currentEpisode,
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/hooks/useEpisodePreservingHref', () => ({
  useEpisodePreservingHref: () => (path: string) => `${path}?episode=episode-1`,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(
    (key: string, values?: Record<string, unknown>) => {
      if (key === 'chars') return `${String(values?.count ?? 0)} chars`
      if (key === 'episodeContext') return `Episode ${String(values?.current)} · ${String(values?.total)} total`
      const labels: Record<string, string> = {
        'noEpisodeSelected': 'No episode selected',
        'noEpisodeContext': 'No episode created yet',
        'promptCreate': 'Create an episode.',
        'promptPaste': 'Paste this episode screenplay.',
        'viewerHint': 'Read only',
        'placeholder.withEpisode': 'Write the screenplay…',
        'placeholder.withoutEpisode': 'Write episode one…',
        'save.creating': 'Creating episode…',
        'save.saving': 'Saving…',
        'save.label': 'Save',
        'firstEpisodeName': 'Ep 1',
        'status.empty': 'No content yet',
        'status.dirty': 'Unsaved changes',
        'status.saving': 'Saving safely',
        'status.saved': 'Saved',
        'status.readonly': 'Read only',
        'next.label': 'Next: breakdown',
      }
      return labels[key] ?? key
    },
    { rich: (key: string) => key },
  ),
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/script/BulkEpisodeUploadButton', () => ({
  BulkEpisodeUploadButton: ({ canEdit }: { canEdit: boolean }) => {
    mocks.bulkCanEdit = canEdit
    return <button type="button" disabled={!canEdit}>Upload script</button>
  },
}))

import { V2ScriptClient } from '@/app/[locale]/v2/workspace/[projectId]/script/V2ScriptClient'

function renderClient(projectData?: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (projectData) {
    queryClient.setQueryData(['project-data', 'project-1'], projectData)
  }
  queryClient.invalidateQueries = mocks.invalidateQueries
  return {
    queryClient,
    ...render(
    <QueryClientProvider client={queryClient}>
      <V2ScriptClient projectId="project-1" locale="en" />
    </QueryClientProvider>,
    ),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function mockNoEpisodes(refetch = vi.fn()) {
  mocks.projectData.mockReturnValue({
    data: { novelPromotionData: { novelText: null, episodes: [] } },
    isLoading: false,
    isError: false,
    error: null,
    refetch,
  })
  mocks.currentEpisode.mockReturnValue({
    currentEpisodeId: null,
    currentEpisode: null,
    episodes: [],
  })
  return refetch
}

describe('V2ScriptClient screenplay persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    mocks.accessRefetch.mockResolvedValue(undefined)
    mocks.projectAccess.mockReturnValue({
      allowed: true,
      canEdit: true,
      canView: true,
      role: 'owner',
      isLoading: false,
      isError: false,
      error: null,
      refetch: mocks.accessRefetch,
    })
    mocks.projectData.mockReturnValue({
      data: {
        novelPromotionData: {
          novelText: 'Original screenplay',
          episodes: [{ id: 'episode-1', episodeNumber: 1, novelText: 'Original screenplay' }],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-1',
      currentEpisode: {
        id: 'episode-1',
        episodeNumber: 1,
        name: 'Episode 1',
        novelText: 'Original screenplay',
      },
      episodes: [{
        id: 'episode-1',
        episodeNumber: 1,
        name: 'Episode 1',
        novelText: 'Original screenplay',
      }],
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('existing episode changed -> PATCH writes the exact screenplay text', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    await waitFor(() => expect(editor).toHaveValue('Original screenplay'))
    fireEvent.change(editor, { target: { value: 'INT. STUDIO — NIGHT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/novel-promotion/project-1/episodes/episode-1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelText: 'INT. STUDIO — NIGHT' }),
      },
    )
  })

  it('empty episode -> stays empty and never falls back to legacy project novelText', async () => {
    mocks.projectData.mockReturnValue({
      data: {
        novelPromotionData: {
          novelText: 'Legacy project screenplay',
          episodes: [{ id: 'episode-1', episodeNumber: 1, novelText: null }],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-1',
      currentEpisode: {
        id: 'episode-1',
        episodeNumber: 1,
        name: 'Episode 1',
        novelText: null,
      },
      episodes: [{ id: 'episode-1', episodeNumber: 1, name: 'Episode 1', novelText: null }],
    })

    renderClient()

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'editor.label' })).toHaveValue(''))
    expect(screen.queryByDisplayValue('Legacy project screenplay')).not.toBeInTheDocument()
  })

  it('successful save -> patches only the exact episode cache before background invalidation', async () => {
    const projectData = {
      id: 'project-1',
      novelPromotionData: {
        novelText: 'Legacy project screenplay',
        episodes: [
          { id: 'episode-1', episodeNumber: 1, novelText: 'Original screenplay' },
          { id: 'episode-2', episodeNumber: 2, novelText: 'Second screenplay' },
        ],
      },
    }
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))
    const { queryClient } = renderClient(projectData)

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Saved episode one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const cached = queryClient.getQueryData<typeof projectData>(['project-data', 'project-1'])
      expect(cached?.novelPromotionData.episodes).toEqual([
        { id: 'episode-1', episodeNumber: 1, novelText: 'Saved episode one' },
        { id: 'episode-2', episodeNumber: 2, novelText: 'Second screenplay' },
      ])
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['project-data', 'project-1'],
    })
  })

  it('late save response for episode A -> never marks or overwrites episode B', async () => {
    const pending = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(pending.promise)
    const view = renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Episode A draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    mocks.projectData.mockReturnValue({
      data: {
        novelPromotionData: {
          episodes: [
            { id: 'episode-1', episodeNumber: 1, novelText: 'Original screenplay' },
            { id: 'episode-2', episodeNumber: 2, novelText: 'Episode B source' },
          ],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-2',
      currentEpisode: {
        id: 'episode-2',
        episodeNumber: 2,
        name: 'Episode 2',
        novelText: 'Episode B source',
      },
      episodes: [
        { id: 'episode-1', episodeNumber: 1, name: 'Episode 1', novelText: 'Original screenplay' },
        { id: 'episode-2', episodeNumber: 2, name: 'Episode 2', novelText: 'Episode B source' },
      ],
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <V2ScriptClient projectId="project-1" locale="en" />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'editor.label' })).toHaveValue('Episode B source'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next: breakdown' })).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'editor.label' }), {
      target: { value: 'Episode B unsaved draft' },
    })

    pending.resolve(new Response('{}', { status: 200 }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'editor.label' })).toHaveValue('Episode B unsaved draft'))
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0)
  })

  it('editing the same episode during save -> late success confirms only the sent snapshot', async () => {
    const pending = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(pending.promise)
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Snapshot v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.change(editor, { target: { value: 'Local v2 while saving' } })
    pending.resolve(new Response('{}', { status: 200 }))

    await waitFor(() => expect(editor).toHaveValue('Local v2 while saving'))
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next: breakdown' })).toBeDisabled()
  })

  it('clearing a saved screenplay -> remains an explicit saveable change', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: '' } })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/novel-promotion/project-1/episodes/episode-1',
      expect.objectContaining({ body: JSON.stringify({ novelText: '' }) }),
    ))
  })

  it('offline save -> preserves the draft, does not send, and exposes retry recovery', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Offline draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(fetch).not.toHaveBeenCalled()
    expect(editor).toHaveValue('Offline draft')
    expect(await screen.findByRole('alert')).toHaveTextContent('states.offlineDescription')
    expect(screen.getByRole('button', { name: 'states.retrySave' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next: breakdown' })).toBeDisabled()
  })

  it('network rejection -> preserves the exact draft and retries the same save', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Network-safe draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('states.networkDescription')
    expect(editor).toHaveValue('Network-safe draft')
    fireEvent.click(screen.getByRole('button', { name: 'states.retrySave' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(fetchMock.mock.calls[0]?.[1])
  })

  it.each([
    [401, 'states.sessionDescription', 'states.sessionAction'],
    [403, 'states.accessChangedDescription', 'states.accessChangedAction'],
  ])('HTTP %s save -> preserves the draft with an explicit recovery state', async (status, descriptionKey, actionKey) => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: `Draft after ${status}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(descriptionKey)
    expect(editor).toHaveValue(`Draft after ${status}`)
    expect(screen.getByRole('button', { name: actionKey })).toBeEnabled()
  })

  it.each([
    [401, 'states.sessionDescription', 'states.sessionAction'],
    [403, 'states.accessChangedDescription', 'states.accessChangedAction'],
  ])('HTTP %s save -> further typing cannot clear the blocking recovery state or send again', async (status, descriptionKey, actionKey) => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response('{}', { status }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: `Draft after ${status}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(descriptionKey)

    fireEvent.change(editor, { target: { value: `Still protected after ${status}` } })
    expect(screen.getByRole('alert')).toHaveTextContent(descriptionKey)
    fireEvent.click(screen.getByRole('button', { name: actionKey }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(editor).toHaveValue(`Still protected after ${status}`)
    expect(mocks.accessRefetch).toHaveBeenCalledOnce()
  })

  it.each([401, 403])('HTTP %s recovery -> unlocks only after edit access is positively reverified', async (status) => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    mocks.accessRefetch.mockResolvedValue({
      isSuccess: true,
      isError: false,
      data: { allowed: true, canEdit: true, canView: true, role: 'editor' },
    })
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: `Recovered draft ${status}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const actionKey = status === 401 ? 'states.sessionAction' : 'states.accessChangedAction'
    fireEvent.click(await screen.findByRole('button', { name: actionKey }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(editor).toHaveValue(`Recovered draft ${status}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it.each([401, 403])('HTTP %s recovery -> stale edit data from a failed recheck stays blocked', async (status) => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response('{}', { status }))
    mocks.accessRefetch.mockResolvedValue({
      isSuccess: false,
      isError: true,
      data: { allowed: true, canEdit: true, canView: true, role: 'editor' },
    })
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: `Stale recovery ${status}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const actionKey = status === 401 ? 'states.sessionAction' : 'states.accessChangedAction'
    fireEvent.click(await screen.findByRole('button', { name: actionKey }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(editor).toHaveValue(`Stale recovery ${status}`)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('viewer -> can read but cannot save or upload', async () => {
    mocks.projectAccess.mockReturnValue({
      allowed: true,
      canEdit: false,
      canView: true,
      role: 'viewer',
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    renderClient()

    expect(await screen.findByRole('textbox', { name: 'editor.label' })).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Upload script' })).toBeDisabled()
    expect(mocks.bulkCanEdit).toBe(false)
  })

  it('access service failure -> offers retry and never disguises it as permission denial', async () => {
    mocks.projectAccess.mockReturnValue({
      allowed: false,
      canEdit: false,
      canView: false,
      role: null,
      isLoading: false,
      isError: true,
      error: new Error('access unavailable'),
      refetch: mocks.accessRefetch,
    })
    renderClient()

    expect(await screen.findByText('states.accessErrorDescription')).toBeInTheDocument()
    expect(screen.queryByText('states.permissionDescription')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'states.accessRetry' }))
    expect(mocks.accessRefetch).toHaveBeenCalledOnce()
  })

  it('background refresh fails with cached data -> keeps the editor and shows a nonblocking warning', async () => {
    mocks.projectData.mockReturnValue({
      data: {
        novelPromotionData: {
          episodes: [{ id: 'episode-1', episodeNumber: 1, novelText: 'Original screenplay' }],
        },
      },
      isLoading: false,
      isError: true,
      error: new Error('refresh failed'),
      refetch: vi.fn(),
    })
    renderClient()

    expect(await screen.findByRole('textbox', { name: 'editor.label' })).toHaveValue('Original screenplay')
    expect(screen.getByText('states.refreshErrorDescription')).toHaveAttribute('role', 'status')
  })

  it('no episode yet -> creates episode before PATCHing the entered screenplay', async () => {
    mockNoEpisodes()
    const fetchMock = vi.mocked(fetch)
    const invalidation = deferred<void>()
    mocks.invalidateQueries.mockReturnValue(invalidation.promise)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ episode: { id: 'episode-new' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'EXT. STREET — DAWN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/novel-promotion/project-1/episodes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ep 1' }),
      },
    ])
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/novel-promotion/project-1/episodes/episode-new',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelText: 'EXT. STREET — DAWN' }),
      },
    ])
    expect(mocks.invalidateQueries).toHaveBeenCalledOnce()
    invalidation.resolve()
  })

  it('first episode POST pending + switch to another episode -> PATCH keeps the click-time draft and leaves the new tab untouched', async () => {
    mockNoEpisodes()
    const post = deferred<Response>()
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockImplementationOnce(() => post.promise)
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const view = renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'INT. ORIGINAL ROOM — NIGHT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-b',
      currentEpisode: {
        id: 'episode-b',
        episodeNumber: 2,
        name: 'Episode B',
        novelText: 'B server draft',
      },
      episodes: [{
        id: 'episode-b',
        episodeNumber: 2,
        name: 'Episode B',
        novelText: 'B server draft',
      }],
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <V2ScriptClient projectId="project-1" locale="en" />
      </QueryClientProvider>,
    )
    const editorB = await screen.findByRole('textbox', { name: 'editor.label' })
    await waitFor(() => expect(editorB).toHaveValue('B server draft'))
    fireEvent.change(editorB, { target: { value: 'B unsaved local draft' } })

    post.resolve(new Response(JSON.stringify({ episode: { id: 'episode-a' } }), { status: 200 }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/novel-promotion/project-1/episodes/episode-a',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelText: 'INT. ORIGINAL ROOM — NIGHT' }),
      },
    ])
    expect(editorB).toHaveValue('B unsaved local draft')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('first episode PATCH 401 -> re-verification retries the same created episode without a duplicate POST', async () => {
    mockNoEpisodes()
    mocks.accessRefetch.mockResolvedValue({
      isSuccess: true,
      isError: false,
      data: { allowed: true, canEdit: true, canView: true, role: 'editor' },
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ episode: { id: 'episode-new' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'INT. SAFE HOUSE — NIGHT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'states.sessionAction' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/novel-promotion/project-1/episodes')).toHaveLength(1)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/novel-promotion/project-1/episodes/episode-new')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/novel-promotion/project-1/episodes/episode-new')
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ novelText: 'INT. SAFE HOUSE — NIGHT' }),
    })
  })

  it('first episode PATCH recovery on its current tab -> saves the latest visible draft, not the stale failed snapshot', async () => {
    mockNoEpisodes()
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ episode: { id: 'episode-new' } }), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('patch response lost'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const view = renderClient()

    const firstEditor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(firstEditor, { target: { value: 'First snapshot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('states.networkDescription')

    const episode = { id: 'episode-new', episodeNumber: 1, name: 'Episode 1', novelText: '' }
    mocks.projectData.mockReturnValue({
      data: { novelPromotionData: { novelText: null, episodes: [episode] } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-new',
      currentEpisode: episode,
      episodes: [episode],
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <V2ScriptClient projectId="project-1" locale="en" />
      </QueryClientProvider>,
    )
    const currentEditor = await screen.findByRole('textbox', { name: 'editor.label' })
    await waitFor(() => expect(currentEditor).toHaveValue('First snapshot'))
    fireEvent.change(currentEditor, { target: { value: 'Latest visible draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'states.retrySave' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ novelText: 'Latest visible draft' }),
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a newer direct save to the pending target -> clears stale first-save recovery', async () => {
    mockNoEpisodes()
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ episode: { id: 'episode-new' } }), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('patch response lost'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const view = renderClient()

    const firstEditor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(firstEditor, { target: { value: 'Stale first snapshot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    const episode = { id: 'episode-new', episodeNumber: 1, name: 'Episode 1', novelText: '' }
    mocks.projectData.mockReturnValue({
      data: { novelPromotionData: { novelText: null, episodes: [episode] } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-new',
      currentEpisode: episode,
      episodes: [episode],
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <V2ScriptClient projectId="project-1" locale="en" />
      </QueryClientProvider>,
    )
    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Newer independently saved version' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ novelText: 'Newer independently saved version' }),
    })
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('failed first save edited on A then retried from B -> PATCHes A latest draft and never touches B', async () => {
    mockNoEpisodes()
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ episode: { id: 'episode-a' } }), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('patch response lost'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const view = renderClient()

    const firstEditor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(firstEditor, { target: { value: 'A version 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('states.networkDescription')

    const episodeA = { id: 'episode-a', episodeNumber: 1, name: 'Episode A', novelText: '' }
    const episodeB = { id: 'episode-b', episodeNumber: 2, name: 'Episode B', novelText: 'B server draft' }
    mocks.projectData.mockReturnValue({
      data: { novelPromotionData: { novelText: null, episodes: [episodeA, episodeB] } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-a',
      currentEpisode: episodeA,
      episodes: [episodeA, episodeB],
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <V2ScriptClient projectId="project-1" locale="en" />
      </QueryClientProvider>,
    )
    const editorA = await screen.findByRole('textbox', { name: 'editor.label' })
    await waitFor(() => expect(editorA).toHaveValue('A version 1'))
    fireEvent.change(editorA, { target: { value: 'A version 2 latest' } })

    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-b',
      currentEpisode: episodeB,
      episodes: [episodeA, episodeB],
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <V2ScriptClient projectId="project-1" locale="en" />
      </QueryClientProvider>,
    )
    const editorB = await screen.findByRole('textbox', { name: 'editor.label' })
    await waitFor(() => expect(editorB).toHaveValue('B server draft'))
    fireEvent.change(editorB, { target: { value: 'B unsaved local draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'states.retrySave' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[2]).toEqual([
      '/api/novel-promotion/project-1/episodes/episode-a',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelText: 'A version 2 latest' }),
      },
    ])
    expect(editorB).toHaveValue('B unsaved local draft')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('first episode creation while offline -> keeps the draft and sends no POST', async () => {
    mockNoEpisodes()
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Offline first episode' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(fetch).not.toHaveBeenCalled()
    expect(editor).toHaveValue('Offline first episode')
    expect(await screen.findByRole('alert')).toHaveTextContent('states.offlineDescription')
  })

  it.each([
    [401, 'states.sessionDescription', 'states.sessionAction'],
    [403, 'states.accessChangedDescription', 'states.accessChangedAction'],
  ])('first episode creation HTTP %s -> keeps a persistent recovery block', async (status, descriptionKey, actionKey) => {
    mockNoEpisodes()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response('{}', { status }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: `Protected first episode ${status}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(descriptionKey)

    fireEvent.change(editor, { target: { value: `Still protected ${status}` } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: actionKey }))
    expect(mocks.accessRefetch).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(editor).toHaveValue(`Still protected ${status}`)
  })

  it('first episode POST 401 then NEW draft changes -> reverify creates and saves the latest NEW text', async () => {
    mockNoEpisodes()
    mocks.accessRefetch.mockResolvedValue({
      isSuccess: true,
      isError: false,
      data: { allowed: true, canEdit: true, canView: true, role: 'editor' },
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ episode: { id: 'episode-new' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'NEW draft version 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('states.sessionDescription')

    fireEvent.change(editor, { target: { value: 'NEW draft version 2 latest' } })
    fireEvent.click(screen.getByRole('button', { name: 'states.sessionAction' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/novel-promotion/project-1/episodes')
    expect(fetchMock.mock.calls[2]).toEqual([
      '/api/novel-promotion/project-1/episodes/episode-new',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelText: 'NEW draft version 2 latest' }),
      },
    ])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('first episode creation network outcome unknown -> reconciles before reusing the discovered episode', async () => {
    const reconciliation = deferred<unknown>()
    const projectRefetch = vi.fn(() => reconciliation.promise)
    mockNoEpisodes(projectRefetch)
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const view = renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Network-safe first episode' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('states.createUnknownDescription')
    fireEvent.click(screen.getByRole('button', { name: 'states.createUnknownAction' }))
    await waitFor(() => expect(projectRefetch).toHaveBeenCalledOnce())

    const discoveredEpisode = {
      id: 'episode-new',
      episodeNumber: 1,
      name: 'Episode 1',
      novelText: '',
    }
    mocks.projectData.mockReturnValue({
      data: { novelPromotionData: { novelText: null, episodes: [discoveredEpisode] } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: projectRefetch,
    })
    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-new',
      currentEpisode: discoveredEpisode,
      episodes: [discoveredEpisode],
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <V2ScriptClient projectId="project-1" locale="en" />
      </QueryClientProvider>,
    )
    reconciliation.resolve({
      isSuccess: true,
      isError: false,
      data: { novelPromotionData: { episodes: [discoveredEpisode] } },
    })
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'editor.label' })).toHaveValue('Network-safe first episode'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/novel-promotion/project-1/episodes')).toHaveLength(1)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/novel-promotion/project-1/episodes/episode-new')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ novelText: 'Network-safe first episode' }),
    })
  })

  it('first episode creation network outcome unknown + failed reconcile -> remains blocked without another POST', async () => {
    const projectRefetch = vi.fn().mockResolvedValue({
      isSuccess: false,
      isError: true,
      data: { novelPromotionData: { episodes: [] } },
    })
    mockNoEpisodes(projectRefetch)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockRejectedValueOnce(new TypeError('network failed'))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Ambiguous first episode' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'states.createUnknownAction' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('states.createUnknownDescription')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(projectRefetch).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(editor).toHaveValue('Ambiguous first episode')
  })

  it('first episode POST pending + switch to B + unknown outcome -> keeps B and exposes the original recovery globally', async () => {
    const post = deferred<Response>()
    const episodeB = {
      id: 'episode-b',
      episodeNumber: 2,
      name: 'Episode B',
      novelText: 'B server draft',
    }
    const episodeA = {
      id: 'episode-a',
      episodeNumber: 1,
      name: 'Episode A',
      novelText: '',
    }
    const projectRefetch = vi.fn().mockResolvedValue({
      isSuccess: true,
      isError: false,
      data: { novelPromotionData: { episodes: [episodeA, episodeB] } },
    })
    mockNoEpisodes(projectRefetch)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementationOnce(() => post.promise)
    const view = renderClient()

    const firstEditor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(firstEditor, { target: { value: 'Original first-episode draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    mocks.projectData.mockReturnValue({
      data: { novelPromotionData: { novelText: null, episodes: [episodeA, episodeB] } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: projectRefetch,
    })
    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-b',
      currentEpisode: episodeB,
      episodes: [episodeA, episodeB],
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <V2ScriptClient projectId="project-1" locale="en" />
      </QueryClientProvider>,
    )
    const editorB = await screen.findByRole('textbox', { name: 'editor.label' })
    await waitFor(() => expect(editorB).toHaveValue('B server draft'))
    fireEvent.change(editorB, { target: { value: 'B unsaved local draft' } })

    post.reject(new TypeError('response lost after create'))
    expect(await screen.findByRole('alert')).toHaveTextContent('states.createUnknownDescription')
    expect(editorB).toHaveValue('B unsaved local draft')

    fireEvent.click(screen.getByRole('button', { name: 'states.createUnknownAction' }))
    await waitFor(() => expect(projectRefetch).toHaveBeenCalledOnce())
    expect(screen.getByRole('alert')).toHaveTextContent('states.createUnknownDescription')
    expect(editorB).toHaveValue('B unsaved local draft')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('first episode unknown outcome + current tab B + unique B on reconcile -> never guesses B is the auto-created episode', async () => {
    const post = deferred<Response>()
    const episodeB = {
      id: 'episode-b',
      episodeNumber: 1,
      name: 'Episode B',
      novelText: 'B server draft',
    }
    const projectRefetch = vi.fn().mockResolvedValue({
      isSuccess: true,
      isError: false,
      data: { novelPromotionData: { episodes: [episodeB] } },
    })
    mockNoEpisodes(projectRefetch)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementationOnce(() => post.promise)
    const view = renderClient()

    const firstEditor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(firstEditor, { target: { value: 'Do not put this into B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    mocks.projectData.mockReturnValue({
      data: { novelPromotionData: { novelText: null, episodes: [episodeB] } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: projectRefetch,
    })
    mocks.currentEpisode.mockReturnValue({
      currentEpisodeId: 'episode-b',
      currentEpisode: episodeB,
      episodes: [episodeB],
    })
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <V2ScriptClient projectId="project-1" locale="en" />
      </QueryClientProvider>,
    )
    const editorB = await screen.findByRole('textbox', { name: 'editor.label' })
    await waitFor(() => expect(editorB).toHaveValue('B server draft'))

    post.reject(new TypeError('response lost after create'))
    fireEvent.click(await screen.findByRole('button', { name: 'states.createUnknownAction' }))
    await waitFor(() => expect(projectRefetch).toHaveBeenCalledOnce())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(editorB).toHaveValue('B server draft')
    expect(screen.getByRole('alert')).toHaveTextContent('states.createUnknownDescription')
  })

  it('first episode creation HTTP 5xx -> treats the create outcome as unknown and never blindly reposts', async () => {
    const projectRefetch = vi.fn().mockResolvedValue({
      isSuccess: false,
      isError: true,
      data: { novelPromotionData: { episodes: [] } },
    })
    mockNoEpisodes(projectRefetch)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: '5xx ambiguous create draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('states.createUnknownDescription')
    fireEvent.click(screen.getByRole('button', { name: 'states.createUnknownAction' }))

    await waitFor(() => expect(projectRefetch).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(editor).toHaveValue('5xx ambiguous create draft')
  })

  it.each([
    ['a missing episode id', () => new Response(JSON.stringify({ episode: {} }), { status: 200 })],
    ['malformed JSON', () => new Response('{not-json', { status: 200 })],
  ])('first episode creation 2xx with %s -> reconciles instead of blindly posting again', async (_label, responseFactory) => {
    const projectRefetch = vi.fn().mockResolvedValue({
      isSuccess: false,
      isError: true,
      data: { novelPromotionData: { episodes: [] } },
    })
    mockNoEpisodes(projectRefetch)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(responseFactory())
    renderClient()

    const editor = await screen.findByRole('textbox', { name: 'editor.label' })
    fireEvent.change(editor, { target: { value: 'Preserved ambiguous draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('states.createUnknownDescription')

    fireEvent.click(screen.getByRole('button', { name: 'states.createUnknownAction' }))
    await waitFor(() => expect(projectRefetch).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(editor).toHaveValue('Preserved ambiguous draft')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
