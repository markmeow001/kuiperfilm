import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PageHeader } from '@/components/v2/PageHeader'
import { ProductionBrand } from '@/components/v2/ProductionBrand'
import { ProductionProgress } from '@/components/v2/ProductionProgress'
import { StatusPill } from '@/components/v2/StatusPill'

describe('production shell primitives', () => {
  it('renders one predictable page heading hierarchy with actions', () => {
    render(
      <PageHeader
        eyebrow="Production"
        title="我的專案"
        description="管理正在製作的作品"
        actions={<button type="button">新建專案</button>}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: '我的專案' })).toBeInTheDocument()
    expect(screen.getByText('管理正在製作的作品')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建專案' })).toBeInTheDocument()
  })

  it('keeps status meaning available as text', () => {
    render(<StatusPill tone="warning" label="等待確認" detail="US$0.42" />)

    const status = screen.getByText('等待確認').parentElement
    expect(status).toBeInTheDocument()
    expect(status?.className).not.toContain('production-gold')
    expect(screen.getByText('US$0.42')).toBeInTheDocument()
  })

  it('exposes the current production step and supports direct navigation', () => {
    const onSelect = vi.fn()
    render(<ProductionProgress currentStep="subjects" onSelect={onSelect} />)

    const current = screen.getByRole('button', { name: /劇本拆解/ })
    expect(current).toHaveAttribute('aria-current', 'step')
    fireEvent.click(screen.getByRole('button', { name: /分鏡/ }))
    expect(onSelect).toHaveBeenCalledWith('storyboard')
  })

  it('links the shared brand back to the production home', () => {
    render(<ProductionBrand locale="zh" />)

    const brand = screen.getByRole('link', { name: 'Kuiper 影界 製作首頁' })
    expect(brand).toHaveAttribute(
      'href',
      '/zh/v2',
    )
    expect(brand).toHaveTextContent('Kuiper')
    expect(brand).toHaveTextContent('影界')
    expect(brand).not.toHaveTextContent(/Kuiperfilm|Production OS/)
  })

  it('dark shell primitives use process cyan without hiding their text labels', () => {
    render(
      <>
        <ProductionBrand locale="en" tone="dark" />
        <ProductionProgress
          currentStep="storyboard"
          locale="en"
          tone="dark"
          onSelect={() => undefined}
        />
      </>,
    )

    expect(screen.getByRole('link', { name: 'Kuiper 影界 production home' })).toBeInTheDocument()
    const currentStep = screen.getByRole('button', { name: /Storyboard.*Current stage/ })
    expect(currentStep).toHaveAttribute('aria-current', 'step')
    expect(currentStep.className).toContain('process-cyan-soft')
    expect(screen.queryByText('分鏡')).not.toBeInTheDocument()
  })

  it('zh production progress does not mix English stage subtitles', () => {
    const { container } = render(
      <ProductionProgress
        currentStep="subjects"
        locale="zh"
        tone="dark"
        onSelect={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: /劇本拆解.*目前階段/ })).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/Mode|Script|Breakdown|Final Cut/)
  })
})
