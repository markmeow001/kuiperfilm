import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LiveCompositeWorkflowGuide } from '@/app/[locale]/live-composite/LiveCompositeWorkflowGuide'

describe('LiveCompositeWorkflowGuide', () => {
  it('顯示目前步驟並允許直接切換流程', () => {
    const onStepChange = vi.fn()
    render(<LiveCompositeWorkflowGuide activeStep={3} completedSteps={new Set([1, 2])} onStepChange={onStepChange} />)

    expect(screen.getByRole('button', { name: '3. 檢查人物邊緣' })).toHaveAttribute('aria-current', 'step')
    fireEvent.click(screen.getByRole('button', { name: '5. 加入虛擬角色（選用）' }))
    expect(onStepChange).toHaveBeenCalledWith(5)
  })
})
