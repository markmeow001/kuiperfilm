import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enProduction from '../../../messages/en/v2Production.json'
import { V2ProjectSettingsPanel } from '@/app/[locale]/v2/workspace/[projectId]/V2ProjectSettingsPanel'
import { queryKeys } from '@/lib/query/keys'
import type { StyleProfileFetched } from '@/lib/query/hooks/useStyleProfile'

const fetchMock = vi.fn<typeof fetch>()

function response(status: number, payload: Record<string, unknown>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('V2ProjectSettingsPanel + style cache integration', () => {
  it('server-confirmed style is visible before Saved and survives a refetch failure', async () => {
    const failedStyleRefetch = deferred<Response>()
    let styleGetCount = 0
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === '/api/projects/project-1/data') {
        return response(200, {
          project: {
            id: 'project-1',
            novelPromotionData: {
              videoRatio: '9:16',
              videoResolution: '720p',
              videoModel: 'atlascloud::seedance-2.0-r2v',
              targetDuration: 60,
              analysisModel: 'atlascloud::text-model',
            },
          },
        })
      }

      if (url === '/api/user/models') {
        return response(200, {
          llm: [{ value: 'atlascloud::text-model', label: 'Atlas Text' }],
          image: [],
          video: [],
          audio: [],
          lipsync: [],
        })
      }

      if (url === '/api/projects/project-1/style-profile' && method === 'PATCH') {
        return response(200, {
          success: true,
          data: {
            id: 'style-1',
            stylePositivePrompt: 'cyberpunk positive',
            styleNegativePrompt: 'cyberpunk negative',
            // A malformed optional field must not erase the last good references.
            styleReferenceImages: 'not-json',
            stylePresetKey: 'cyberpunk',
            visualStyleId: 'cinematic_realism',
            lightingPresetId: 'golden_hour',
          },
        })
      }

      if (url === '/api/projects/project-1/style-profile') {
        styleGetCount += 1
        if (styleGetCount === 1) {
          return response(200, {
            success: true,
            data: {
              id: 'style-1',
              stylePositivePrompt: 'realistic positive',
              styleNegativePrompt: 'realistic negative',
              styleReferenceImages: ['reference-1'],
              stylePresetKey: 'realistic',
              visualStyleId: 'cinematic_realism',
              lightingPresetId: 'golden_hour',
            },
          })
        }
        return failedStyleRefetch.promise
      }

      throw new Error(`Unexpected request: ${method} ${url}`)
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider
          locale="en"
          messages={{ v2Production: enProduction }}
        >
          <V2ProjectSettingsPanel projectId="project-1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    )

    const previous = await screen.findByRole('button', { name: 'Realistic' })
    expect(previous).toHaveAttribute('aria-pressed', 'true')
    const next = screen.getAllByRole('button', { name: 'Cyberpunk' })[0]

    fireEvent.click(next)

    await waitFor(() => expect(next).toHaveAttribute('aria-pressed', 'true'))
    expect(previous).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')
    expect(
      queryClient.getQueryData<StyleProfileFetched>(
        queryKeys.project.styleProfile('project-1'),
      )?.styleReferenceImages,
    ).toEqual(['reference-1'])

    await act(async () => {
      failedStyleRefetch.resolve(
        response(503, { error: 'style refresh unavailable' }),
      )
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
    expect(next).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('settings-background-style')).toHaveTextContent(
      'style refresh unavailable',
    )
  })
})
