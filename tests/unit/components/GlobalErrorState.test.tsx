import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/font/google', () => ({
  Noto_Sans_TC: () => ({ className: 'test-font' }),
}))

import { GlobalErrorContent } from '@/app/global-error'

describe('global error state', () => {
  it('does not expose internal error details and lets the user retry', () => {
    const reset = vi.fn()

    render(<GlobalErrorContent reset={reset} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Kuiper 暫時無法啟動')
    expect(screen.queryByText(/private root stack|secret-digest/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新啟動 / Retry' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
