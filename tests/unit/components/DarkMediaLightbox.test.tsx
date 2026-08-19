import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DarkMediaLightbox } from '@/components/v2/DarkMediaLightbox'

function LightboxHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  return (
    <>
      <button type="button" onClick={() => setSrc('/frame.jpg')}>
        開啟劇照
      </button>
      <DarkMediaLightbox
        src={src}
        alt="第 12 鏡"
        closeLabel="關閉劇照預覽"
        dismissHint="點擊背景或按 Esc 關閉"
        onClose={() => {
          onClose()
          setSrc(null)
        }}
      />
    </>
  )
}

describe('DarkMediaLightbox', () => {
  it('開啟預覽 -> portal 使用 night-blue tokens 並將初始焦點放在 44px 關閉按鈕', () => {
    render(<LightboxHarness />)

    fireEvent.click(screen.getByRole('button', { name: '開啟劇照' }))

    const dialog = screen.getByRole('dialog', { name: '圖片預覽：第 12 鏡' })
    const closeButton = screen.getByRole('button', { name: '關閉劇照預覽' })
    expect(dialog).toHaveAttribute('data-theme', 'production-studio')
    expect(dialog).toHaveClass('bg-[var(--production-paper)]', 'text-[var(--production-ink)]')
    expect(closeButton).toHaveClass('h-11', 'w-11', 'focus-visible:ring-[var(--production-focus)]')
    expect(closeButton).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('預覽開啟後按 Tab -> 焦點不會離開 dialog', () => {
    render(<LightboxHarness />)
    fireEvent.click(screen.getByRole('button', { name: '開啟劇照' }))

    const closeButton = screen.getByRole('button', { name: '關閉劇照預覽' })
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(closeButton).toHaveFocus()

    screen.getByRole('dialog').focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(closeButton).toHaveFocus()
  })

  it('按 Escape 關閉 -> 還原 trigger 焦點與頁面捲動', () => {
    const onClose = vi.fn()
    render(<LightboxHarness onClose={onClose} />)
    const trigger = screen.getByRole('button', { name: '開啟劇照' })
    trigger.focus()
    fireEvent.click(trigger)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('點圖片不關閉、點背景關閉 -> 僅 backdrop 觸發 dismiss', () => {
    const onClose = vi.fn()
    render(<LightboxHarness onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '開啟劇照' }))

    fireEvent.click(screen.getByRole('img', { name: '第 12 鏡' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
