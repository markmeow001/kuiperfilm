import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CompositeToolbar } from '@/app/[locale]/live-composite/CompositeToolbar'

describe('CompositeToolbar', () => {
  it('選擇移除畫筆與合成檢視 -> 回傳明確工具狀態', () => {
    const onToolChange = vi.fn()
    const onViewChange = vi.fn()
    render(
      <CompositeToolbar
        tool="keep"
        view="source"
        brushPercent={6}
        overlayVisible
        canUndo
        canRedo={false}
        onToolChange={onToolChange}
        onViewChange={onViewChange}
        onBrushPercentChange={vi.fn()}
        onOverlayVisibleChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onClear={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '移除畫筆' }))
    fireEvent.click(screen.getByRole('button', { name: '查看合成結果' }))
    expect(onToolChange).toHaveBeenCalledWith('erase')
    expect(onViewChange).toHaveBeenCalledWith('composite')
  })

  it('調整筆刷至 12% -> 回傳數值而非字串', () => {
    const onBrushPercentChange = vi.fn()
    render(
      <CompositeToolbar
        tool="keep"
        view="source"
        brushPercent={6}
        overlayVisible
        canUndo={false}
        canRedo={false}
        onToolChange={vi.fn()}
        onViewChange={vi.fn()}
        onBrushPercentChange={onBrushPercentChange}
        onOverlayVisibleChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onClear={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('slider', { name: '筆刷大小' }), { target: { value: '12' } })
    expect(onBrushPercentChange).toHaveBeenCalledWith(12)
  })

  it('影片輸出中 -> 遮罩與檢視控制全部鎖定', () => {
    render(
      <CompositeToolbar
        tool="keep"
        view="composite"
        brushPercent={6}
        overlayVisible
        canUndo
        canRedo
        disabled
        onToolChange={vi.fn()}
        onViewChange={vi.fn()}
        onBrushPercentChange={vi.fn()}
        onOverlayVisibleChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onClear={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '保留畫筆' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看合成結果' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: '筆刷大小' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '顯示選區' })).toBeDisabled()
  })
})
