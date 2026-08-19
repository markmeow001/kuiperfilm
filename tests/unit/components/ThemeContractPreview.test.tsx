import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeContractPreview } from '@/app/[locale]/dev/components/ThemeContractPreview'

describe('ThemeContractPreview', () => {
  it('shows planning and media workspaces in one unified dark contract without implying live data', () => {
    render(<ThemeContractPreview />)

    expect(screen.getByRole('heading', { name: '統一深色製片工作區' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '角色與世界觀' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '鏡頭 07 · 雨夜月台' })).toBeInTheDocument()
    expect(screen.getByText(/只供設計檢查，不連接正式資料/)).toBeInTheDocument()
  })

  it('allows the production stage specimen to change with accessible buttons', () => {
    render(<ThemeContractPreview />)

    const voice = screen.getByRole('button', { name: /05.*聲音/ })
    fireEvent.click(voice)

    expect(voice).toHaveClass('bg-[var(--process-cyan-soft)]')
  })
})
