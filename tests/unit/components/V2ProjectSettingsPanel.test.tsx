import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enProduction from '../../../messages/en/v2Production.json'
import zhProduction from '../../../messages/zh/v2Production.json'
import { V2ProjectSettingsPanel } from '@/app/[locale]/v2/workspace/[projectId]/V2ProjectSettingsPanel'

const mocks = vi.hoisted(() => ({
  useProjectData: vi.fn(),
  useStyleProfile: vi.fn(),
  useUserModels: vi.fn(),
  useUpdateProjectConfig: vi.fn(),
  useUpdateStyleProfile: vi.fn(),
}))

vi.mock('@/lib/query/hooks/useProjectData', () => ({
  useProjectData: mocks.useProjectData,
}))

vi.mock('@/lib/query/hooks/useStyleProfile', () => ({
  useStyleProfile: mocks.useStyleProfile,
}))

vi.mock('@/lib/query/hooks/useUserModels', () => ({
  useUserModels: mocks.useUserModels,
}))

vi.mock('@/lib/query/mutations/useProjectConfigMutations', () => ({
  useUpdateProjectConfig: mocks.useUpdateProjectConfig,
}))

vi.mock('@/lib/query/mutations/updateStyleProfile', () => ({
  useUpdateStyleProfile: mocks.useUpdateStyleProfile,
}))

const projectData = {
  id: 'project-1',
  novelPromotionData: {
    videoRatio: '9:16',
    videoResolution: '720p',
    videoModel: 'atlascloud::seedance-2.0-r2v',
    targetDuration: 60,
    analysisModel: 'atlascloud::text-model',
  },
}

const styleData = {
  id: 'style-1',
  stylePositivePrompt: null,
  styleNegativePrompt: null,
  styleReferenceImages: null,
  stylePresetKey: 'realistic',
  visualStyleId: 'cinematic_realism',
  lightingPresetId: 'golden_hour',
}

const modelsData = {
  llm: [
    {
      value: 'atlascloud::text-model',
      label: 'Atlas Text',
      providerName: 'AtlasCloud',
    },
  ],
  image: [],
  video: [],
  audio: [],
  lipsync: [],
}

function queryState<T>(data: T | undefined, options: Record<string, unknown> = {}) {
  return {
    data,
    isPending: data === undefined,
    isLoading: data === undefined,
    isFetching: data === undefined,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...options,
  }
}

function renderPanel(locale: 'zh' | 'en' = 'zh') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{
        v2Production: locale === 'en' ? enProduction : zhProduction,
      }}
    >
      <V2ProjectSettingsPanel projectId="project-1" />
    </NextIntlClientProvider>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('V2ProjectSettingsPanel state closure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProjectData.mockReturnValue(queryState(projectData))
    mocks.useStyleProfile.mockReturnValue(queryState(styleData))
    mocks.useUserModels.mockReturnValue(queryState(modelsData))
    mocks.useUpdateProjectConfig.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ success: true }),
    })
    mocks.useUpdateStyleProfile.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ success: true }),
    })
  })

  it('initial loading never renders clickable fallback settings', () => {
    mocks.useProjectData.mockReturnValue(queryState(undefined))
    mocks.useStyleProfile.mockReturnValue(queryState(undefined))
    mocks.useUserModels.mockReturnValue(queryState(undefined))

    renderPanel('en')

    expect(screen.getByText('Loading production settings')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /9:16/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it.each([
    ['Project settings', 'project', mocks.useProjectData],
    ['Style profile', 'style', mocks.useStyleProfile],
    ['Text models', 'models', mocks.useUserModels],
  ] as const)(
    'first-screen %s error names its source and retries only that query',
    (_sourceLabel, source, hook) => {
      const retry = vi.fn()
      hook.mockReturnValue(
        queryState(undefined, {
          isPending: false,
          isLoading: false,
          isFetching: false,
          isError: true,
          error: new Error(`${source} unavailable`),
          refetch: retry,
        }),
      )

      renderPanel('en')

      const issue = screen.getByTestId(`settings-source-${source}`)
      expect(issue).toHaveTextContent(_sourceLabel)
      expect(issue).toHaveTextContent(`${source} unavailable`)
      fireEvent.click(within(issue).getByRole('button', { name: 'Retry' }))
      expect(retry).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: /9:16/ })).not.toBeInTheDocument()
    },
  )

  it('cached data remains usable after a background refetch failure', () => {
    const retryStyle = vi.fn()
    mocks.useStyleProfile.mockReturnValue(
      queryState(styleData, {
        isError: true,
        error: new Error('background style refresh failed'),
        refetch: retryStyle,
      }),
    )

    renderPanel('en')

    expect(screen.getByRole('button', { name: /9:16/ })).toHaveAttribute('aria-pressed', 'true')
    const issue = screen.getByTestId('settings-background-style')
    expect(issue).toHaveTextContent('Style profile')
    expect(issue).toHaveTextContent('background style refresh failed')
    fireEvent.click(within(issue).getByRole('button', { name: 'Retry' }))
    expect(retryStyle).toHaveBeenCalledTimes(1)
  })

  it('config save announces progress, prevents duplicate submits, and announces success', async () => {
    const save = deferred<{ success: boolean }>()
    const mutateAsync = vi.fn(() => save.promise)
    mocks.useUpdateProjectConfig.mockReturnValue({ isPending: false, mutateAsync })
    renderPanel('en')

    const target = screen.getByRole('button', { name: /16:9/ })
    fireEvent.click(target)
    fireEvent.click(target)

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true)

    await act(async () => save.resolve({ success: true }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
  })

  it('config failure reports rollback details and retries the exact last payload', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error('configuration rejected'))
      .mockResolvedValueOnce({ success: true })
    mocks.useUpdateProjectConfig.mockReturnValue({ isPending: false, mutateAsync })
    renderPanel('en')

    fireEvent.click(screen.getByRole('button', { name: /16:9/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Save failed. The previous setting was restored.')
    expect(alert).toHaveTextContent('configuration rejected')
    expect(screen.getByRole('button', { name: /9:16/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry save' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
    expect(mutateAsync).toHaveBeenCalledTimes(2)
    expect(mutateAsync.mock.calls[0]?.[0]).toEqual({ key: 'videoRatio', value: '16:9' })
    expect(mutateAsync.mock.calls[1]?.[0]).toEqual(mutateAsync.mock.calls[0]?.[0])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('style save does not paint a new selection before success and supports retry', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error('style service offline'))
      .mockResolvedValueOnce({ success: true })
    mocks.useUpdateStyleProfile.mockReturnValue({ isPending: false, mutateAsync })
    renderPanel('en')

    const current = screen.getByRole('button', { name: 'Realistic' })
    const target = screen.getAllByRole('button', { name: 'Cyberpunk' })[0]
    fireEvent.click(target)

    expect(target).toHaveAttribute('aria-pressed', 'false')
    expect(current).toHaveAttribute('aria-pressed', 'true')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('style service offline')

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry save' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
    expect(mutateAsync).toHaveBeenCalledTimes(2)
    expect(mutateAsync.mock.calls[1]?.[0]).toEqual(mutateAsync.mock.calls[0]?.[0])
  })

  it('English locale does not leak Chinese settings labels', () => {
    const { container } = renderPanel('en')

    expect(screen.getByText('Project settings')).toBeInTheDocument()
    expect(screen.getByText('Aspect ratio')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Realistic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Golden Hour' })).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/畫面|整集|寫實風格|黃金時刻|尚無啟用/)
  })
})
