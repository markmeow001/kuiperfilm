import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FacePerformancePanel } from '@/app/[locale]/live-composite/FacePerformancePanel'
import type { FacePerformanceTrack } from '@/app/[locale]/live-composite/lib/face-performance'

const idleProgress = { status: 'idle' as const, completed: 0, total: 0, message: '' }

function box(x: number, y: number) {
  return { x, y, w: 0.3, h: 0.3 }
}

const track: FacePerformanceTrack = {
  samples: [
    { time: 0, faceBox: box(0.2, 0.2), blendshapeSummary: { jawOpen: 0.2, mouthSmileLeft: 0.1, mouthSmileRight: 0.1 } },
    { time: 0.5, faceBox: null, blendshapeSummary: null },
    { time: 1, faceBox: box(0.21, 0.2), blendshapeSummary: { jawOpen: 0.9, mouthSmileLeft: 0.6, mouthSmileRight: 0.8 } },
  ],
}

describe('FacePerformancePanel', () => {
  it('可分析時 -> 按鈕觸發 onAnalyze', () => {
    const onAnalyze = vi.fn()
    render(
      <FacePerformancePanel
        canAnalyze
        progress={idleProgress}
        track={null}
        onAnalyze={onAnalyze}
        onCancel={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '分析臉部表演' }))
    expect(onAnalyze).toHaveBeenCalledTimes(1)
  })

  it('輸出或其他分析進行中（canAnalyze=false）-> 分析按鈕鎖定', () => {
    render(
      <FacePerformancePanel
        canAnalyze={false}
        progress={idleProgress}
        track={null}
        onAnalyze={vi.fn()}
        onCancel={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '分析臉部表演' })).toBeDisabled()
  })

  it('分析進行中 -> 顯示進度並允許取消，分析按鈕鎖定', () => {
    const onCancel = vi.fn()
    render(
      <FacePerformancePanel
        canAnalyze
        progress={{ status: 'analyzing', completed: 3, total: 4, message: '已完成 3 / 4 個臉部影格' }}
        track={null}
        onAnalyze={vi.fn()}
        onCancel={onCancel}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '分析臉部表演' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '取消臉部分析' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('分析完成 -> 顯示偵測影格數、漏檢時間碼與表情峰值，可清除', () => {
    const onClear = vi.fn()
    render(
      <FacePerformancePanel
        canAnalyze
        progress={{ status: 'completed', completed: 3, total: 3, message: '臉部表演分析完成' }}
        track={track}
        onAnalyze={vi.fn()}
        onCancel={vi.fn()}
        onClear={onClear}
      />,
    )
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    // 漏檢 0.5 秒（同時也是問題時間碼，兩列都會顯示）
    expect(screen.getAllByText('0.50s')).toHaveLength(2)
    // 峰值：jawOpen 與微笑都在 1 秒
    expect(screen.getByText('嘴巴張最開')).toBeInTheDocument()
    expect(screen.getByText('1.00s（0.90）')).toBeInTheDocument()
    expect(screen.getByText('笑容最明顯')).toBeInTheDocument()
    expect(screen.getByText('1.00s（0.70）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除臉部表演資料' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('失敗 -> 錯誤訊息以 alert 呈現', () => {
    render(
      <FacePerformancePanel
        canAnalyze
        progress={{ status: 'failed', completed: 0, total: 10, message: '臉部表演分析失敗' }}
        track={null}
        onAnalyze={vi.fn()}
        onCancel={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('臉部表演分析失敗')
  })
})
