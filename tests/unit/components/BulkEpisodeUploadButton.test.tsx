import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enScript from '../../../messages/en/v2Script.json'
import zhScript from '../../../messages/zh/v2Script.json'
import { BulkEpisodeUploadButton } from '@/app/[locale]/v2/workspace/[projectId]/script/BulkEpisodeUploadButton'

const invalidateQueries = vi.fn()

function renderImport({
  locale = 'en',
  existingEpisodeCount = 0,
  canEdit = true,
}: {
  locale?: 'en' | 'zh'
  existingEpisodeCount?: number
  canEdit?: boolean
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.invalidateQueries = invalidateQueries
  const messages = locale === 'en' ? enScript : zhScript
  const renderTree = (editable: boolean) => (
    <NextIntlClientProvider locale={locale} messages={{ v2Script: messages }}>
      <QueryClientProvider client={queryClient}>
        <BulkEpisodeUploadButton
          projectId="project-1"
          existingEpisodeCount={existingEpisodeCount}
          canEdit={editable}
          viewerTip="Read only"
          tone="studio"
        />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  const view = render(renderTree(canEdit))
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input missing')
  return {
    ...view,
    input,
    rerenderWithEditAccess: (editable: boolean) => view.rerender(renderTree(editable)),
  }
}

const extracted = {
  mode: 'markers',
  episodes: [
    { number: 1, title: 'Arrival', content: 'INT. STATION — NIGHT', wordCount: 20 },
    { number: 2, title: 'Departure', content: 'EXT. PLATFORM — DAWN', wordCount: 21 },
  ],
  rawText: 'raw script',
  meta: {
    sourceFormat: 'txt',
    plainTextChars: 41,
    languages: { detected: ['en'], isMultilingual: false },
  },
}

describe('BulkEpisodeUploadButton', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('entry point -> states formats, limits, deterministic parsing and no AI cost', () => {
    const { input } = renderImport()

    expect(screen.getByRole('button', { name: 'Import screenplay file' })).toBeEnabled()
    expect(screen.getByText(/DOCX, text-layer PDF, TXT, MD/)).toBeInTheDocument()
    expect(screen.getByText(/10 MB/)).toBeInTheDocument()
    expect(screen.getByText(/200 episodes/)).toBeInTheDocument()
    expect(screen.getByText(/65,535 UTF-8 bytes/)).toBeInTheDocument()
    expect(screen.getByText(/191 characters/)).toBeInTheDocument()
    expect(screen.getByText(/does not call AI/)).toBeInTheDocument()
    expect(input.accept).toBe('.docx,.pdf,.txt,.md,.markdown')
  })

  it('viewer -> can read the limits but cannot open the file picker', () => {
    renderImport({ canEdit: false })
    expect(screen.getByRole('button', { name: 'Import screenplay file' })).toBeDisabled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('access revoked while preview is open -> disables import and sends no batch mutation', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(extracted), { status: 200 }),
    )
    const { input, rerenderWithEditAccess } = renderImport()
    fireEvent.change(input, {
      target: { files: [new File(['screenplay'], 'script.txt', { type: 'text/plain' })] },
    })

    expect(await screen.findByRole('dialog', { name: 'Review imported episodes' })).toBeInTheDocument()
    rerenderWithEditAccess(false)
    const confirm = screen.getByRole('button', { name: 'Add 2 episodes' })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('extraction -> opens a named dialog; Escape closes and restores trigger focus', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(extracted), { status: 200 }),
    )
    const { input } = renderImport()
    const trigger = screen.getByRole('button', { name: 'Import screenplay file' })
    trigger.focus()
    fireEvent.change(input, {
      target: { files: [new File(['screenplay'], 'script.txt', { type: 'text/plain' })] },
    })

    const dialog = await screen.findByRole('dialog', { name: 'Review imported episodes' })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('replace mode -> names the three affected episodes and sends clearExisting=true', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(extracted), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const { input } = renderImport({ existingEpisodeCount: 3 })
    fireEvent.change(input, {
      target: { files: [new File(['screenplay'], 'script.txt', { type: 'text/plain' })] },
    })

    expect(await screen.findByText('Keep all 3 current episodes and append this import.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Replace current episodes/ }))
    expect(screen.getByText('Permanently replace 3 current episodes with this import.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Replace with 2 episodes' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/novel-promotion/project-1/episodes/batch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodes: [
            { name: 'Arrival', novelText: 'INT. STATION — NIGHT' },
            { name: 'Departure', novelText: 'EXT. PLATFORM — DAWN' },
          ],
          clearExisting: true,
          importStatus: 'imported',
        }),
      },
    ])
  })

  it('batch failure -> preserves preview and strategy so Retry sends the same payload', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(extracted), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const { input } = renderImport({ locale: 'zh', existingEpisodeCount: 2 })
    fireEvent.change(input, {
      target: { files: [new File(['screenplay'], 'script.txt', { type: 'text/plain' })] },
    })

    await screen.findByRole('dialog', { name: '檢查匯入集數' })
    fireEvent.click(screen.getByRole('radio', { name: /取代目前集數/ }))
    fireEvent.click(screen.getByRole('button', { name: '取代為 2 集' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('集數沒有匯入成功')
    expect(screen.getByRole('dialog', { name: '檢查匯入集數' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /取代目前集數/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '重試匯入' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(fetchMock.mock.calls[1]?.[1])
  })

  it('batch transport outcome unknown -> preserves preview and blocks blind resend', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(extracted), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('response lost'))
    const { input } = renderImport({ existingEpisodeCount: 2 })
    fireEvent.change(input, {
      target: { files: [new File(['screenplay'], 'script.txt', { type: 'text/plain' })] },
    })

    await screen.findByRole('dialog', { name: 'Review imported episodes' })
    fireEvent.click(screen.getByRole('radio', { name: /Replace current episodes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace with 2 episodes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Direct resend is blocked')
    expect(screen.getByRole('radio', { name: /Replace current episodes/ })).toBeChecked()
    const confirm = screen.getByRole('button', { name: 'Replace with 2 episodes' })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Refresh project episodes' })).toBeEnabled()
  })

  it('batch HTTP 5xx outcome unknown -> blocks blind resend just like a lost response', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(extracted), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    const { input } = renderImport({ existingEpisodeCount: 2 })
    fireEvent.change(input, {
      target: { files: [new File(['screenplay'], 'script.txt', { type: 'text/plain' })] },
    })

    await screen.findByRole('dialog', { name: 'Review imported episodes' })
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 episodes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Direct resend is blocked')
    expect(screen.getByRole('button', { name: 'Add 2 episodes' })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('multilingual prose -> selected script filters the single-episode payload', async () => {
    const multilingualProse = {
      mode: 'prose',
      episodes: [],
      rawText: [
        '這是一段足夠長的中文劇情，角色走進房間並望向窗外等待消息。',
        '',
        'This is a sufficiently long English scene where the character enters and waits by the window.',
      ].join('\n'),
      meta: {
        sourceFormat: 'txt',
        plainTextChars: 130,
        languages: { detected: ['zh', 'en'], isMultilingual: true },
      },
    }
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(multilingualProse), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const { input } = renderImport()
    fireEvent.change(input, {
      target: { files: [new File(['screenplay'], 'script.txt', { type: 'text/plain' })] },
    })

    await screen.findByRole('dialog', { name: 'Review imported episodes' })
    fireEvent.click(screen.getByRole('radio', { name: 'English / Latin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add one episode' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      episodes: Array<{ novelText: string }>
    }
    expect(request.episodes[0]?.novelText).toContain('This is a sufficiently long English scene')
    expect(request.episodes[0]?.novelText).not.toContain('這是一段足夠長的中文劇情')
  })

  it('stable extraction error -> maps the code without showing raw JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: { details: { code: 'PDF_NO_TEXT_LAYER' } },
    }), { status: 400 }))
    const { input } = renderImport()
    fireEvent.change(input, {
      target: { files: [new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('This PDF has no text layer')
    expect(screen.getByRole('alert')).not.toHaveTextContent('PDF_NO_TEXT_LAYER')
  })

  it('more than 200 detected episodes -> blocks the paid mutation', async () => {
    const oversized = {
      ...extracted,
      episodes: Array.from({ length: 201 }, (_, index) => ({
        number: index + 1,
        title: `Episode ${index + 1}`,
        content: 'Scene',
        wordCount: 5,
      })),
    }
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(oversized), { status: 200 }),
    )
    const { input } = renderImport()
    fireEvent.change(input, {
      target: { files: [new File(['screenplay'], 'script.txt', { type: 'text/plain' })] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('more than 200 episodes')
    expect(screen.getByRole('button', { name: 'Add 201 episodes' })).toBeDisabled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('CJK screenplay under the character limit but over 65,535 UTF-8 bytes -> blocks batch POST', async () => {
    const cjkText = '漢'.repeat(21_846)
    expect(cjkText.length).toBeLessThan(65_535)
    const oversizedText = {
      ...extracted,
      episodes: [{
        number: 1,
        title: 'CJK Episode',
        content: cjkText,
        wordCount: cjkText.length,
      }],
    }
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(oversizedText), { status: 200 }),
    )
    const { input } = renderImport()
    fireEvent.change(input, {
      target: { files: [new File(['screenplay'], 'script.txt', { type: 'text/plain' })] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Episode 1 exceeds 65,535 UTF-8 bytes')
    expect(screen.getByRole('button', { name: 'Add 1 episodes' })).toBeDisabled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
