import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'zh' }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

import { SystemStateScreen } from '@/components/system/SystemStateScreen'

describe('SystemStateScreen', () => {
  it('loading -> 以禮貌狀態公告並維持統一深色介面', () => {
    render(<SystemStateScreen state="loading" locale="zh" />)

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('正在準備工作區')).toBeInTheDocument()
    expect(screen.getByTestId('system-state-screen')).toHaveClass(
      'bg-[#070B0F]',
      '[--primary-400:#55AFC0]',
    )
  })

  it('error -> 不揭露原始錯誤，並提供可操作的重新載入', () => {
    const onRetry = vi.fn()
    render(
      <SystemStateScreen
        state="error"
        locale="zh"
        onRetry={onRetry}
        errorDigest="private-stack-content"
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('這個頁面暫時無法顯示')
    expect(screen.queryByText('private-stack-content')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('not-found -> 英文頁保留 locale 並提供明確返回路徑', () => {
    render(<SystemStateScreen state="not-found" locale="en" />)

    expect(screen.getByRole('heading', { name: 'This page could not be found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to projects' })).toHaveAttribute(
      'href',
      '/en/v2',
    )
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/en')
  })

  it('forbidden -> 顯示權限語意，而不是一般系統錯誤', () => {
    render(<SystemStateScreen state="forbidden" locale="zh" />)

    expect(screen.getByRole('alert')).toHaveTextContent('無法開啟這個頁面')
    expect(screen.getByText(/你目前沒有檢視權限/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回到專案總覽' })).toHaveAttribute(
      'href',
      '/zh/v2',
    )
  })
})
