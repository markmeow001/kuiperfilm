import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DepthRebuildGuidePlanPanel,
  type DepthRebuildGuidePlanPanelProps,
} from '@/app/[locale]/live-composite/DepthRebuildGuidePlanPanel'

function buildProps(
  overrides: Partial<DepthRebuildGuidePlanPanelProps> = {},
): DepthRebuildGuidePlanPanelProps {
  return {
    strategy: 'depth-plus-detail',
    sourceDuration: 11.2,
    outputDuration: 12,
    primaryDuration: 11.2,
    secondaryStart: 4,
    secondaryDuration: 3.3,
    totalReferenceDuration: 14.5,
    maxReferenceDuration: 15,
    criticalCenterSeconds: 5.7,
    onCriticalCenterChange: vi.fn(),
    ...overrides,
  }
}

describe('DepthRebuildGuidePlanPanel', () => {
  it('完整 Depth 加關鍵 RGB -> 顯示 11.2、3.3、14.5 秒與裁切說明', () => {
    render(<DepthRebuildGuidePlanPanel {...buildProps()} />)

    expect(screen.getByText('完整 Depth＋關鍵 RGB')).toBeInTheDocument()
    const depthRow = screen.getByText('Depth 引導').closest('div')
    expect(depthRow).not.toBeNull()
    expect(within(depthRow as HTMLElement).getByText('11.2 秒')).toBeInTheDocument()
    expect(screen.getByText('3.3 秒')).toBeInTheDocument()
    expect(screen.getByText('14.5 / 15 秒')).toBeInTheDocument()
    expect(screen.getByText(/不代表本機深度影片已產生/)).toBeInTheDocument()
    expect(screen.getByText(/先用模型需要的整數片長生成 12 秒，再自動裁回原片 11.2 秒/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '參考影片總長' })).toHaveAttribute(
      'aria-valuenow',
      '14.5',
    )
  })

  it('關鍵 RGB 模式調整位置 -> slider 使用實際秒數並回傳 number', () => {
    const onCriticalCenterChange = vi.fn()
    render(
      <DepthRebuildGuidePlanPanel
        {...buildProps({ onCriticalCenterChange })}
      />,
    )

    const slider = screen.getByRole('slider', { name: '關鍵動作位置' })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '11.2')
    expect(slider).toHaveAttribute('step', '0.1')
    expect(slider).toHaveValue('5.7')

    fireEvent.change(slider, { target: { value: '6.4' } })
    expect(onCriticalCenterChange).toHaveBeenCalledWith(6.4)
  })

  it('[關鍵動作 slider] -> 放在獨立的可觸控 label', () => {
    render(<DepthRebuildGuidePlanPanel {...buildProps()} />)

    const hitArea = screen.getByRole('slider', { name: '關鍵動作位置' })
      .closest('[data-live-composite-control-hit-area]')

    expect(hitArea?.tagName).toBe('LABEL')
  })

  it('完整雙引導 -> 顯示完整 RGB 且不顯示關鍵位置 slider', () => {
    render(
      <DepthRebuildGuidePlanPanel
        {...buildProps({
          strategy: 'full-dual',
          sourceDuration: 7,
          outputDuration: 7,
          primaryDuration: 7,
          secondaryStart: 0,
          secondaryDuration: 7,
          totalReferenceDuration: 14,
          maxReferenceDuration: 15,
        })}
      />,
    )

    expect(screen.getByText('完整 Depth＋完整 RGB')).toBeInTheDocument()
    expect(screen.getByText(/完整原片會送入同一次生成/)).toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: '關鍵動作位置' })).not.toBeInTheDocument()
  })

  it('只用 Depth -> 明確顯示不使用 RGB 且不顯示 slider', () => {
    render(
      <DepthRebuildGuidePlanPanel
        {...buildProps({
          strategy: 'depth-only',
          secondaryStart: 0,
          secondaryDuration: 0,
          totalReferenceDuration: 11.2,
        })}
      />,
    )

    expect(screen.getByText('只用完整 Depth')).toBeInTheDocument()
    expect(screen.getByText('不使用')).toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: '關鍵動作位置' })).not.toBeInTheDocument()
  })

  it('參考總長超過上限 -> 顯示可操作的明確警告', () => {
    render(
      <DepthRebuildGuidePlanPanel
        {...buildProps({ totalReferenceDuration: 15.1 })}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      '參考影片總長超過 15 秒上限，請縮短關鍵 RGB 片段後再生成。',
    )
  })

  it('控制項停用 -> 關鍵動作 slider 不可調整', () => {
    render(<DepthRebuildGuidePlanPanel {...buildProps({ disabled: true })} />)

    expect(screen.getByRole('slider', { name: '關鍵動作位置' })).toBeDisabled()
  })
})
