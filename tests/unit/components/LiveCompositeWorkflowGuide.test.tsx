import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LiveCompositeWorkflowGuide } from '@/app/[locale]/live-composite/LiveCompositeWorkflowGuide'
import { ALLOWED_TRACK_B_MODELS } from '@/app/[locale]/live-composite/lib/atlascloud-r2v-contract'

describe('LiveCompositeWorkflowGuide', () => {
  it('顯示目前步驟並允許直接切換流程', () => {
    const onStepChange = vi.fn()
    render(<LiveCompositeWorkflowGuide activeStep={3} completedSteps={new Set([1, 2])} onStepChange={onStepChange} />)

    expect(screen.getByRole('button', { name: '3. 檢查人物邊緣' })).toHaveAttribute('aria-current', 'step')
    fireEvent.click(screen.getByRole('button', { name: '5. 加入虛擬角色（選用）' }))
    expect(onStepChange).toHaveBeenCalledWith(5)
  })

  it('Track B 七步為主流程；已具備步驟可切換，生成側步驟顯示規劃中且不可點', () => {
    const onStepChange = vi.fn()
    render(<LiveCompositeWorkflowGuide activeStep={3} completedSteps={new Set([1, 2])} onStepChange={onStepChange} />)

    expect(screen.getByText('主流程 · 表演驅動角色重製')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Track B 1. 表演素材' }))
    expect(onStepChange).toHaveBeenCalledWith(1)

    const plannedLabels = [
      'Track B 3. AI 角色（規劃中，待 B0 放行）',
      'Track B 4. AI 場景（規劃中，待 B0 放行）',
      'Track B 5. 快速預覽（規劃中，待 B0 放行）',
      'Track B 6. 品質檢查（規劃中，待 B0 放行）',
      'Track B 7. 正式輸出（規劃中，待 B0 放行）',
    ]
    onStepChange.mockClear()
    for (const name of plannedLabels) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(onStepChange).not.toHaveBeenCalled()
  })

  it('引擎清單只顯示 AtlasCloud Seedance Fast/Standard 兩個模型（讀自契約常數）', () => {
    render(<LiveCompositeWorkflowGuide activeStep={1} completedSteps={new Set()} onStepChange={vi.fn()} />)

    for (const modelKey of ALLOWED_TRACK_B_MODELS) {
      expect(screen.getByText(modelKey)).toBeInTheDocument()
    }
    expect(screen.queryByText(/ark::|fal::|kling::|bobapi::/i)).not.toBeInTheDocument()
  })
})
