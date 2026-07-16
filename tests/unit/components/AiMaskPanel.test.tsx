import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AiMaskPanel } from '@/app/[locale]/live-composite/AiMaskPanel'

describe('AiMaskPanel', () => {
  it('調整參數後掃描整段 -> 傳出明確的取樣與遮罩設定', () => {
    const onAnalyzeClip = vi.fn()
    render(
      <AiMaskPanel
        canAnalyze
        currentTime={1.25}
        progress={{ status: 'idle', completed: 0, total: 0, message: '' }}
        onAnalyzeCurrent={vi.fn()}
        onAnalyzeClip={onAnalyzeClip}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('AI 遮罩取樣間隔'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('人物信心門檻'), { target: { value: '0.6' } })
    fireEvent.change(screen.getByLabelText('AI 遮罩邊緣柔化'), { target: { value: '0.08' } })
    fireEvent.click(screen.getByRole('button', { name: '掃描整段影片' }))

    expect(onAnalyzeClip).toHaveBeenCalledWith({ interval: 2, threshold: 0.6, edgeSoftness: 0.08 })
  })

  it('分析進行中 -> 顯示具體進度並允許取消', () => {
    const onCancel = vi.fn()
    render(
      <AiMaskPanel
        canAnalyze
        currentTime={1.25}
        progress={{ status: 'analyzing', completed: 3, total: 4, message: '已完成 3 / 4 個分析影格' }}
        onAnalyzeCurrent={vi.fn()}
        onAnalyzeClip={vi.fn()}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '掃描整段影片' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '分析完目前影格後取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
