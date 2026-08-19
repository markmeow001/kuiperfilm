import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SaveToLibraryDialog } from '@/app/[locale]/live-composite/SaveToLibraryDialog'

const mocks = vi.hoisted(() => ({
  listUserCanvases: vi.fn(),
  createCanvasLibraryAsset: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/app/[locale]/live-composite/lib/canvas-library-api', () => ({
  listUserCanvases: mocks.listUserCanvases,
  createCanvasLibraryAsset: mocks.createCanvasLibraryAsset,
}))

vi.mock('@/lib/query/mutations/playground-mutations', () => ({
  useUploadPlaygroundReference: () => ({ mutateAsync: mocks.upload }),
}))

function DialogHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>開啟資產視窗</button>
      {open ? (
        <SaveToLibraryDialog
          asset={{
            blob: new Blob(['preview'], { type: 'image/png' }),
            assetType: 'image',
            mimeType: 'image/png',
            fileName: 'preview.png',
            defaultName: '合成預覽',
          }}
          locale="zh"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

describe('SaveToLibraryDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.listUserCanvases.mockResolvedValue([
      { id: 'canvas-1', title: '主畫布', updatedAt: '2026-08-12T00:00:00.000Z' },
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('[開啟資產視窗] -> 使用 aria-modal、將焦點移入並把 Tab 留在視窗內', async () => {
    render(<DialogHarness />)

    fireEvent.click(screen.getByRole('button', { name: '開啟資產視窗' }))
    await act(async () => {
      await Promise.resolve()
      vi.runOnlyPendingTimers()
    })

    const dialog = screen.getByRole('dialog', { name: '存入資產庫' })
    const close = screen.getByRole('button', { name: '關閉存入資產庫視窗' })
    const finalAction = screen.getByRole('button', { name: '存入並在畫布建立節點' })

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(close).toHaveFocus()

    finalAction.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
  })

  it('[按 Escape 關閉] -> 回到原本開啟視窗的按鈕', async () => {
    render(<DialogHarness />)
    const trigger = screen.getByRole('button', { name: '開啟資產視窗' })

    trigger.focus()
    fireEvent.click(trigger)
    await act(async () => {
      await Promise.resolve()
      vi.runOnlyPendingTimers()
    })
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: '存入資產庫' })).toBeNull()
    expect(trigger).toHaveFocus()
  })
})
