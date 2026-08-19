import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CompositeExportPanel } from '@/app/[locale]/live-composite/CompositeExportPanel'

describe('CompositeExportPanel', () => {
  it('預設保留原音 -> 點擊完整輸出時傳出 true', () => {
    const onExportVideo = vi.fn()
    render(
      <CompositeExportPanel
        canExport
        progress={{ status: 'idle', currentTime: 0, duration: 10, message: '' }}
        onExportMask={vi.fn()}
        onExportFrame={vi.fn()}
        onExportVideo={onExportVideo}
        onCancelVideo={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '輸出完整合成影片' }))
    expect(onExportVideo).toHaveBeenCalledWith(true)
  })

  it('錄製到一半 -> 顯示進度、鎖住 PNG 輸出並允許取消', () => {
    const onCancelVideo = vi.fn()
    render(
      <CompositeExportPanel
        canExport
        progress={{ status: 'recording', currentTime: 5, duration: 20, message: '正在逐幀合成影片…' }}
        onExportMask={vi.fn()}
        onExportFrame={vi.fn()}
        onExportVideo={vi.fn()}
        onCancelVideo={onCancelVideo}
      />,
    )

    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下載遮罩 PNG' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '取消輸出' }))
    expect(onCancelVideo).toHaveBeenCalledTimes(1)
  })

  it('有完成的輸出 -> 顯示存入資產庫按鈕並可點擊；沒有輸出則不顯示', () => {
    const onSaveToLibrary = vi.fn()
    const { rerender } = render(
      <CompositeExportPanel
        canExport
        progress={{ status: 'completed', currentTime: 10, duration: 10, message: '合成影片已完成。' }}
        onExportMask={vi.fn()}
        onExportFrame={vi.fn()}
        onExportVideo={vi.fn()}
        onCancelVideo={vi.fn()}
        lastExportLabel="合成影片"
        onSaveToLibrary={onSaveToLibrary}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '存入資產庫（合成影片）' }))
    expect(onSaveToLibrary).toHaveBeenCalledTimes(1)

    rerender(
      <CompositeExportPanel
        canExport
        progress={{ status: 'idle', currentTime: 0, duration: 10, message: '' }}
        onExportMask={vi.fn()}
        onExportFrame={vi.fn()}
        onExportVideo={vi.fn()}
        onCancelVideo={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /存入資產庫/ })).toBeNull()
  })

  it('關閉原音 -> 完整輸出傳出 false', () => {
    const onExportVideo = vi.fn()
    render(
      <CompositeExportPanel
        canExport
        progress={{ status: 'idle', currentTime: 0, duration: 10, message: '' }}
        onExportMask={vi.fn()}
        onExportFrame={vi.fn()}
        onExportVideo={onExportVideo}
        onCancelVideo={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '保留實拍影片原音' }))
    fireEvent.click(screen.getByRole('button', { name: '輸出完整合成影片' }))
    expect(onExportVideo).toHaveBeenCalledWith(false)
  })

  it('[原音 checkbox] -> 放在獨立的可觸控 label', () => {
    render(
      <CompositeExportPanel
        canExport
        progress={{ status: 'idle', currentTime: 0, duration: 10, message: '' }}
        onExportMask={vi.fn()}
        onExportFrame={vi.fn()}
        onExportVideo={vi.fn()}
        onCancelVideo={vi.fn()}
      />,
    )

    const hitArea = screen.getByRole('checkbox', { name: '保留實拍影片原音' })
      .closest('[data-live-composite-control-hit-area]')

    expect(hitArea?.tagName).toBe('LABEL')
  })
})
