import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiscussionStudio } from '@/app/[locale]/playground/DiscussionStudio'

describe('DiscussionStudio', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers Venice and Sao10K and submits the selected model', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => (
      new Response(JSON.stringify({
        message: { role: 'assistant', content: '先強化主角的外在目標。' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    ))
    vi.stubGlobal('fetch', fetchMock)
    render(<DiscussionStudio />)

    expect(screen.getByRole('option', { name: 'Venice: Uncensored' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Sao10K · Euryale 70B' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('討論模型'), {
      target: { value: 'openrouter::sao10k/l3.3-euryale-70b' },
    })
    fireEvent.change(screen.getByPlaceholderText(/貼上劇本片段/), {
      target: { value: '請分析主角的目標。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '送出討論' }))

    await screen.findByText('先強化主角的外在目標。')
    expect(fetchMock).toHaveBeenCalledOnce()
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      modelKey: 'openrouter::sao10k/l3.3-euryale-70b',
      messages: [{ role: 'user', content: '請分析主角的目標。' }],
    })
  })

  it('keeps the draft message visible when the model request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'OpenRouter 暫時無法使用' },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    render(<DiscussionStudio />)

    fireEvent.change(screen.getByPlaceholderText(/貼上劇本片段/), {
      target: { value: '這場戲的衝突夠強嗎？' },
    })
    fireEvent.click(screen.getByRole('button', { name: '送出討論' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('OpenRouter 暫時無法使用'))
    expect(screen.getByText('這場戲的衝突夠強嗎？')).toBeInTheDocument()
  })
})
