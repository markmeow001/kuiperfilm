import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import zhJobs from '../../../messages/zh/v2Jobs.json'
import { ProductionContractPreview } from '@/app/[locale]/dev/components/ProductionContractPreview'

function renderPreview() {
  return render(
    <NextIntlClientProvider locale="zh" messages={{ v2Jobs: zhJobs }}>
      <ProductionContractPreview />
    </NextIntlClientProvider>,
  )
}

describe('ProductionContractPreview', () => {
  it('renders the production rail, shared generator, jobs, versions, and state matrix', () => {
    renderPreview()

    expect(screen.getByRole('heading', { name: '角色與世界觀工作站' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '統一生成順序與送出條件' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '任務生命週期' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '非成功狀態也必須可以繼續工作' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '開始生成' })).toBeEnabled()
    expect(screen.getAllByText('US$1.15').length).toBeGreaterThan(0)
  })

  it('supports keyboard-safe entity search and version selection', () => {
    renderPreview()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋清單' }), {
      target: { value: '北門' },
    })
    expect(screen.getByText('北門車站')).toBeInTheDocument()
    expect(screen.queryByText('陳默')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '選擇版本' })[0])
    expect(screen.getAllByText('目前版本').length).toBeGreaterThan(0)
  })
})
