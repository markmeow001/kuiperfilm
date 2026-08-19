import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LiveCompositeModeSelector } from '@/app/[locale]/live-composite/LiveCompositeModeSelector'

describe('LiveCompositeModeSelector', () => {
  it('[預設深度模式] -> 以單一可命名 radiogroup 顯示兩個繁中模式與明確選取狀態', () => {
    render(
      <LiveCompositeModeSelector
        value="depth-rebuild"
        onChange={() => undefined}
      />,
    )

    const group = screen.getByRole('radiogroup', { name: '實拍處理方式' })
    expect(group).toHaveAttribute('data-live-composite-mode-nav')

    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(
      within(group).getByRole('radio', { name: /AI 深度重建/ }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      within(group).getByRole('radio', { name: /精修遮罩合成/ }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText(/演员|场景|头发|进阶/)).not.toBeInTheDocument()
  })

  it('[選擇精修遮罩合成] -> 精確回傳 mask-composite 模式', () => {
    const onChange = vi.fn<(mode: 'depth-rebuild' | 'mask-composite') => void>()
    render(
      <LiveCompositeModeSelector value="depth-rebuild" onChange={onChange} />,
    )

    fireEvent.click(screen.getByRole('radio', { name: /精修遮罩合成/ }))

    expect(onChange).toHaveBeenCalledWith('mask-composite')
  })

  it('[工作區忙碌] -> 兩個模式控制都停用且不能觸發切換', () => {
    const onChange = vi.fn<(mode: 'depth-rebuild' | 'mask-composite') => void>()
    render(
      <LiveCompositeModeSelector
        value="depth-rebuild"
        onChange={onChange}
        disabled
      />,
    )

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    for (const radio of radios) expect(radio).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: /精修遮罩合成/ }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
