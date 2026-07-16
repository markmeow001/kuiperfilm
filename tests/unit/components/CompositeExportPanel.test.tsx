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
})
