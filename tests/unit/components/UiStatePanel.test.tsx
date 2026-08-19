import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UiStatePanel, type UiStateKind } from '@/components/v2/UiStatePanel'

const EXPECTED_LABELS: Record<UiStateKind, string> = {
  loading: '處理中',
  empty: '尚無內容',
  partial: '部分完成',
  offline: '離線',
  stale: '資料已更新',
  permission: '權限不足',
  'low-credits': '點數不足',
  error: '發生錯誤',
  conflict: '版本衝突',
}

describe('UiStatePanel', () => {
  it.each(Object.entries(EXPECTED_LABELS) as [UiStateKind, string][])(
    '%s 狀態 -> 顯示文字標籤與可辨識的狀態容器',
    (state, label) => {
      const { container } = render(<UiStatePanel state={state} />)

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(
        container.querySelector(`[data-state="${state}"]`),
      ).toBeInTheDocument()
    },
  )

  it('錯誤狀態 -> 使用 alert 語意並保留錯誤細節', () => {
    render(
      <UiStatePanel state="error" details={<span>任務編號：task-42</span>} />,
    )

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByText('任務編號：task-42')).toBeInTheDocument()
  })

  it('自訂操作 -> primary 與 secondary action 都可以執行', () => {
    const onRetry = vi.fn()
    const onDismiss = vi.fn()
    render(
      <UiStatePanel
        state="offline"
        primaryAction={<button onClick={onRetry}>重新連線</button>}
        secondaryAction={<button onClick={onDismiss}>稍後處理</button>}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '重新連線' }))
    fireEvent.click(screen.getByRole('button', { name: '稍後處理' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('loading 狀態 -> 標記 aria-busy，其他狀態不標記', () => {
    const { rerender } = render(<UiStatePanel state="loading" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')

    rerender(<UiStatePanel state="empty" />)
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy')
  })

  it('英文 locale -> 預設狀態標籤與內容不回退成中文', () => {
    render(<UiStatePanel state="error" locale="en" />)

    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(
      screen.getByText('The operation did not complete'),
    ).toBeInTheDocument()
  })

  it.each(['stale', 'low-credits'] as const)(
    '%s 狀態 -> 使用警示語意，不占用核准與交付金色',
    (state) => {
      const { container } = render(<UiStatePanel state={state} />)
      const icon = container.querySelector('[aria-hidden="true"]')

      expect(icon?.className).toContain('text-amber-200')
      expect(icon?.className).not.toContain('production-gold')
    },
  )
})
