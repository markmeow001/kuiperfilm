import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VisualDevelopmentImage } from '@/app/[locale]/visual-development/VisualDevelopmentImage'

describe('VisualDevelopmentImage lightbox', () => {
  it('點擊縮圖 -> 開啟放大預覽，Escape 後關閉並恢復頁面捲動', () => {
    render(<VisualDevelopmentImage src="/world-core.jpg" alt="World Core Formula" />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '放大圖片：World Core Formula' }))

    expect(screen.getByRole('dialog', { name: '圖片預覽：World Core Formula' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'World Core Formula' })).toHaveLength(2)
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('放大預覽開啟 -> 關閉按鈕可退出', () => {
    render(<VisualDevelopmentImage src="/material.jpg" alt="Material Aging" />)

    fireEvent.click(screen.getByRole('button', { name: '放大圖片：Material Aging' }))
    fireEvent.click(screen.getByRole('button', { name: '關閉放大圖片' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
