import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import enJobs from '../../../messages/en/v2Jobs.json'
import zhJobs from '../../../messages/zh/v2Jobs.json'
import { JobCard, type JobStatus } from '@/components/v2/JobCard'

const statusLabels: Record<JobStatus, string> = {
  estimated: '費用試算',
  queued: '排隊中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失敗',
  cancelled: '已取消',
  refunded: '已退款',
}

function renderCard(ui: ReactNode, locale: 'zh' | 'en' = 'zh') {
  const messages = { v2Jobs: locale === 'en' ? enJobs : zhJobs }
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  })
}

describe('JobCard', () => {
  it('English provider with no label overrides -> shared card never falls back to Chinese', () => {
    renderCard(
      <JobCard
        title="Video generation"
        status="failed"
        model="Seedance 2.0"
      />,
      'en',
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Error: The job failed without a detailed reason.',
    )
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/u)
  })

  it.each(Object.entries(statusLabels) as Array<[JobStatus, string]>)('以文字顯示 %s 狀態', (status, label) => {
    renderCard(
      <JobCard
        title="鏡頭 03 生成"
        status={status}
        model="Seedance 2.0 R2V"
        cost="US$1.24"
      />,
    )

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('Seedance 2.0 R2V')).toBeInTheDocument()
    expect(screen.getByText('US$1.24')).toBeInTheDocument()
  })

  it('顯示並限制供應商回報的進度範圍', () => {
    renderCard(
      <JobCard
        title="背景重建"
        status="running"
        model="Seedance 2.0 R2V"
        progress={142}
      />,
    )

    const progressbar = screen.getByRole('progressbar', { name: '任務進度' })
    expect(progressbar).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('未記錄')).toBeInTheDocument()
  })

  it('供應商尚未回報進度時顯示明確狀態', () => {
    renderCard(
      <JobCard title="角色版本" status="queued" model="Seedance 2.0 R2V" />,
    )

    const progressbar = screen.getByRole('progressbar', { name: '任務進度' })
    expect(progressbar).not.toHaveAttribute('aria-valuenow')
    expect(progressbar).toHaveAttribute('aria-valuetext', '等待工作節點回報')
    expect(screen.getByText('等待工作節點回報')).toBeInTheDocument()
  })

  it('失敗與退款均提供可讀的原因區塊', () => {
    const { rerender } = renderCard(
      <JobCard
        title="失敗任務"
        status="failed"
        model="Seedance 2.0 R2V"
        error="參考素材格式不支援"
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('參考素材格式不支援')

    rerender(
      <JobCard
        title="退款任務"
        status="refunded"
        model="Seedance 2.0 R2V"
        refund="US$1.24 已退回點數錢包"
      />,
    )

    expect(screen.getByText(/US\$1\.24 已退回點數錢包/)).toBeInTheDocument()
  })

  it('渲染預覽與操作插槽，並為直接操作元素保留觸控高度', () => {
    renderCard(
      <JobCard
        title="可操作任務"
        status="succeeded"
        model="Seedance 2.0 R2V"
        preview={<div>任務預覽</div>}
        primaryAction={<button type="button">下載</button>}
        secondaryActions={<button type="button">查看版本</button>}
        appearance="editor"
      />,
    )

    expect(screen.getByText('任務預覽')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下載' }).parentElement).toHaveClass('[&_button]:min-h-11')
    expect(screen.getByRole('button', { name: '查看版本' }).parentElement).toHaveClass('[&_button]:min-h-11')
  })

  it('English locale labels -> overrides every embedded status and metadata label', () => {
    renderCard(
      <JobCard
        title="Video generation"
        status="queued"
        model="Seedance 2.0"
        labels={{
          status: { queued: 'Queued' },
          model: 'Model',
          missingCost: 'Not recorded',
          progress: 'Job progress',
          waitingProgress: 'Waiting for provider',
        }}
        details={<div>Technical details</div>}
      />,
    )

    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Job progress' })).toHaveAttribute(
      'aria-valuetext',
      'Waiting for provider',
    )
    expect(screen.getByText('Technical details')).toBeInTheDocument()
  })
})
