import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from '@/components/v2/Modal'

function ModalHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        開啟協作視窗
      </button>
      <Modal
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
      >
        <Modal.Header heading="協作者" onClose={() => setOpen(false)} />
        <Modal.Body>
          <button type="button">中間操作</button>
        </Modal.Body>
        <Modal.Footer>
          <button type="button">最後操作</button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

describe('Modal accessibility', () => {
  it('開啟視窗 -> 綁定標題、限制 Tab 焦點並由 Escape 關閉後回到觸發按鈕', async () => {
    const onClose = vi.fn()
    render(<ModalHarness onClose={onClose} />)

    const trigger = screen.getByRole('button', { name: '開啟協作視窗' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '協作者' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute(
      'aria-labelledby',
      screen.getByRole('heading', { name: '協作者' }).id,
    )

    const close = screen.getByRole('button', { name: '關閉' })
    await waitFor(() => expect(close).toHaveFocus())

    const last = screen.getByRole('button', { name: '最後操作' })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
