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

    expect(onAnalyzeClip).toHaveBeenCalledWith({ engine: 'rvm', interval: 2, threshold: 0.6, edgeSoftness: 0.08 })
  })

  it('選擇精細追蹤 -> 以 0.25 秒間隔掃描', () => {
    const onAnalyzeClip = vi.fn()
    render(
      <AiMaskPanel
        canAnalyze
        currentTime={0}
        progress={{ status: 'idle', completed: 0, total: 0, message: '' }}
        onAnalyzeCurrent={vi.fn()}
        onAnalyzeClip={onAnalyzeClip}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('AI 遮罩取樣間隔'), { target: { value: '0.25' } })
    fireEvent.click(screen.getByRole('button', { name: '掃描整段影片' }))

    expect(onAnalyzeClip).toHaveBeenCalledWith({ engine: 'rvm', interval: 0.25, threshold: 0.5, edgeSoftness: 0.12 })
  })

  it('引擎預設 RVM（推薦・逐幀時序）-> 掃描帶 engine rvm', () => {
    const onAnalyzeCurrent = vi.fn()
    render(
      <AiMaskPanel
        canAnalyze
        currentTime={0}
        progress={{ status: 'idle', completed: 0, total: 0, message: '' }}
        onAnalyzeCurrent={onAnalyzeCurrent}
        onAnalyzeClip={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('AI 遮罩引擎')).toHaveValue('rvm')
    fireEvent.click(screen.getByRole('button', { name: '目前影格 0.0s' }))
    expect(onAnalyzeCurrent).toHaveBeenCalledWith({ engine: 'rvm', interval: 1, threshold: 0.5, edgeSoftness: 0.12 })
  })

  it('切換回 Selfie Segmenter（舊版）-> 掃描帶 engine selfie', () => {
    const onAnalyzeClip = vi.fn()
    render(
      <AiMaskPanel
        canAnalyze
        currentTime={0}
        progress={{ status: 'idle', completed: 0, total: 0, message: '' }}
        onAnalyzeCurrent={vi.fn()}
        onAnalyzeClip={onAnalyzeClip}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('AI 遮罩引擎'), { target: { value: 'selfie' } })
    fireEvent.click(screen.getByRole('button', { name: '掃描整段影片' }))
    expect(onAnalyzeClip).toHaveBeenCalledWith({ engine: 'selfie', interval: 1, threshold: 0.5, edgeSoftness: 0.12 })
  })

  it('RVM 引擎 -> 顯示門檻＝透明度下限的說明；切到 Selfie 則隱藏', () => {
    render(
      <AiMaskPanel
        canAnalyze
        currentTime={0}
        progress={{ status: 'idle', completed: 0, total: 0, message: '' }}
        onAnalyzeCurrent={vi.fn()}
        onAnalyzeClip={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/門檻是透明度下限/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('AI 遮罩引擎'), { target: { value: 'selfie' } })
    expect(screen.queryByText(/門檻是透明度下限/)).not.toBeInTheDocument()
  })

  it('分析進行中 -> 引擎選擇器鎖定', () => {
    render(
      <AiMaskPanel
        canAnalyze
        currentTime={0}
        progress={{ status: 'analyzing', completed: 1, total: 4, message: 'RVM · WebGPU｜已處理 2.0 / 8.0 秒' }}
        onAnalyzeCurrent={vi.fn()}
        onAnalyzeClip={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('AI 遮罩引擎')).toBeDisabled()
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

  it('分析中整體素材互動鎖定（canAnalyze=false）-> 取消按鈕仍可使用', () => {
    const onCancel = vi.fn()
    render(
      <AiMaskPanel
        canAnalyze={false}
        currentTime={1.25}
        progress={{ status: 'analyzing', completed: 1, total: 4, message: '分析 1.00 秒的人物輪廓…' }}
        onAnalyzeCurrent={vi.fn()}
        onAnalyzeClip={vi.fn()}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByRole('button', { name: '目前影格 1.3s' })).toBeDisabled()
    const cancelButton = screen.getByRole('button', { name: '分析完目前影格後取消' })
    expect(cancelButton).toBeEnabled()
    fireEvent.click(cancelButton)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
