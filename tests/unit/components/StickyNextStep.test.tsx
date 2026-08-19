import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StickyNextStep } from '@/components/v2/StickyNextStep'

describe('StickyNextStep', () => {
  it('shows prerequisite state and runs primary and secondary actions', () => {
    const onPrimaryAction = vi.fn()
    const onSecondaryAction = vi.fn()
    render(
      <StickyNextStep
        title="進入分鏡"
        description="把已確認的劇本轉成鏡頭。"
        primaryLabel="下一步：分鏡"
        onPrimaryAction={onPrimaryAction}
        ready
        prerequisites={[
          { id: 'script', label: '劇本已儲存', met: true },
          { id: 'cast', label: '角色已綁定', met: true },
        ]}
        secondaryAction={{ label: '預覽劇本', onAction: onSecondaryAction }}
      />,
    )

    expect(screen.getByText('2 項前置條件已完成')).toBeInTheDocument()
    expect(screen.getByText('劇本已儲存').closest('li')).toHaveTextContent('已完成')
    fireEvent.click(screen.getByRole('button', { name: '下一步：分鏡' }))
    fireEvent.click(screen.getByRole('button', { name: '預覽劇本' }))
    expect(onPrimaryAction).toHaveBeenCalledOnce()
    expect(onSecondaryAction).toHaveBeenCalledOnce()
  })

  it('blocks the primary action and explains the next recovery step', () => {
    const onPrimaryAction = vi.fn()
    render(
      <StickyNextStep
        title="進入分鏡"
        primaryLabel="下一步：分鏡"
        onPrimaryAction={onPrimaryAction}
        ready={false}
        disabledReason="請先綁定至少一名角色。"
        prerequisites={[
          { id: 'script', label: '劇本已儲存', met: true },
          { id: 'cast', label: '角色已綁定', met: false },
        ]}
      />,
    )

    expect(screen.getByText('尚有 1 項前置條件')).toBeInTheDocument()
    expect(screen.getByText('角色已綁定').closest('li')).toHaveTextContent('待完成')
    expect(screen.getByRole('status')).toHaveTextContent('請先綁定至少一名角色。')
    const button = screen.getByRole('button', { name: '下一步：分鏡' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onPrimaryAction).not.toHaveBeenCalled()
  })

  it('keeps both mobile actions at the 44px touch-target floor', () => {
    render(
      <StickyNextStep
        title="下一個工作階段"
        primaryLabel="繼續"
        onPrimaryAction={vi.fn()}
        ready
        secondaryAction={{ label: '稍後處理', onAction: vi.fn() }}
      />,
    )

    expect(screen.getByRole('button', { name: '繼續' })).toHaveClass('min-h-11')
    expect(screen.getByRole('button', { name: '稍後處理' })).toHaveClass('min-h-11')
  })
})
