import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LiveCompositeModeSelector } from '@/app/[locale]/live-composite/LiveCompositeModeSelector'

describe('LiveCompositeModeSelector', () => {
  it('深度重建已選取 -> 清楚說明不需遮罩，且切換回傳 mask-composite', () => {
    const onChange = vi.fn()
    render(<LiveCompositeModeSelector value="depth-rebuild" onChange={onChange} />)

    expect(screen.getByRole('radio', { name: /AI 深度重建/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('換演員、服裝與場景，不必先畫人物遮罩。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /精修遮罩合成/ }))
    expect(onChange).toHaveBeenCalledWith('mask-composite')
  })

  it('控制停用 -> 兩種模式都不能觸發切換', () => {
    const onChange = vi.fn()
    render(<LiveCompositeModeSelector value="depth-rebuild" onChange={onChange} disabled />)

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    for (const radio of radios) expect(radio).toBeDisabled()
    fireEvent.click(radios[1])
    expect(onChange).not.toHaveBeenCalled()
  })
})
