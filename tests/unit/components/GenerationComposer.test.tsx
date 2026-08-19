import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GenerationComposer } from '@/components/v2/GenerationComposer'

function slot(name: string) {
  return <div>{name} 內容</div>
}

const fields = {
  prompt: slot('Prompt'),
  references: slot('References'),
  style: slot('Style'),
  model: slot('Model'),
  ratio: slot('Ratio'),
  count: slot('Count'),
  advanced: slot('Advanced'),
}

describe('GenerationComposer', () => {
  it('always renders injected slots in the production decision order', () => {
    const { container } = render(
      <GenerationComposer
        {...fields}
        ready
        cost={{ status: 'available', value: 'US$0.42' }}
        onGenerate={vi.fn()}
      />,
    )

    const order = [
      'prompt',
      'references',
      'style',
      'model',
      'ratio',
      'count',
      'advanced',
      'cost',
    ].map((name) => container.querySelector(`[data-composer-slot="${name}"]`))

    expect(order.every(Boolean)).toBe(true)
    for (let index = 0; index < order.length - 1; index += 1) {
      const current = order[index]
      const next = order[index + 1]
      if (!current || !next) throw new Error('Expected every composer slot to render')
      expect(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('shows an explicit cost and submits only when ready', () => {
    const onGenerate = vi.fn()
    render(
      <GenerationComposer
        {...fields}
        ready
        cost={{ status: 'available', value: 'US$0.42', note: '送出前不會扣款' }}
        onGenerate={onGenerate}
      />,
    )

    expect(screen.getByText('US$0.42')).toBeInTheDocument()
    expect(screen.getByText('送出前不會扣款')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: '開始生成' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onGenerate).toHaveBeenCalledOnce()
  })

  it('keeps generation disabled and exposes the recovery reason', () => {
    render(
      <GenerationComposer
        {...fields}
        ready={false}
        disabledReason="請先選擇輸出模型。"
        cost={{ status: 'available', value: 'US$0.42' }}
        onGenerate={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('請先選擇輸出模型。')
    expect(screen.getByRole('button', { name: '開始生成' })).toBeDisabled()
  })

  it('does not submit while the cost is unavailable', () => {
    const onGenerate = vi.fn()
    render(
      <GenerationComposer
        {...fields}
        ready
        cost={{ status: 'unavailable', reason: '目前無法取得模型價格。' }}
        onGenerate={onGenerate}
      />,
    )

    expect(screen.getAllByText('目前無法取得模型價格。')).toHaveLength(2)
    const button = screen.getByRole('button', { name: '開始生成' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onGenerate).not.toHaveBeenCalled()
  })
})
