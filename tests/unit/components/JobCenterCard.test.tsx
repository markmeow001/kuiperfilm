import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import enJobs from '../../../messages/en/v2Jobs.json'
import zhJobs from '../../../messages/zh/v2Jobs.json'
import { JobCenterCard } from '@/app/[locale]/v2/jobs/JobCenterCard'
import type { JobView } from '@/lib/task/job-view'

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: 'task-1',
    type: 'video_panel',
    title: 'Video Panel',
    typeLabel: 'Video Panel',
    targetType: 'StoryboardPanel',
    targetId: 'panel-1234567890',
    projectId: 'project-1',
    episodeId: 'episode-1',
    status: 'completed',
    progress: 100,
    model: 'atlascloud::seedance-2.0-r2v',
    cost: { estimated: 1.5, actual: 1.2, currency: 'CNY' },
    billingStatus: 'charged',
    refund: { status: 'not_refunded', amount: null },
    error: null,
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:01:00.000Z',
    queuedAt: '2026-08-08T10:00:00.000Z',
    startedAt: '2026-08-08T10:00:10.000Z',
    finishedAt: '2026-08-08T10:01:00.000Z',
    durationMs: 50_000,
    attempt: 1,
    maxAttempts: 3,
    stageLabel: 'Rendering',
    canCancel: false,
    ...overrides,
  }
}

function renderCard(
  value: JobView,
  options: {
    locale?: 'zh' | 'en'
    allowCancel?: boolean
    onCancel?: (taskId: string) => Promise<unknown>
  } = {},
) {
  const locale = options.locale ?? 'zh'
  const onCancel = options.onCancel ?? vi.fn(async () => undefined)
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ v2Jobs: locale === 'en' ? enJobs : zhJobs }}
    >
      <JobCenterCard
        job={value}
        locale={locale}
        allowCancel={options.allowCancel ?? true}
        onCancel={onCancel}
      />
    </NextIntlClientProvider>,
  )
  return { onCancel }
}

describe('JobCenterCard', () => {
  it('已完成但已退款 -> 同時保留任務狀態與獨立退款結果', () => {
    renderCard(job({
      billingStatus: 'refunded',
      refund: { status: 'refunded', amount: null },
      cost: { estimated: 1.5, actual: 0, currency: 'CNY' },
    }))

    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText(/已回滾預留費用/)).toBeInTheDocument()
    expect(screen.getByText(/預估/)).toHaveTextContent(/CNY\s*1\.50/)
    expect(screen.queryByRole('button', { name: '取消任務' })).not.toBeInTheDocument()
  })

  it('進行中且有編輯權 -> 二次確認後才取消任務', async () => {
    const onCancel = vi.fn(async () => ({ success: true }))
    renderCard(job({
      status: 'running',
      progress: 47,
      canCancel: true,
      finishedAt: null,
    }), { onCancel })

    fireEvent.click(screen.getByRole('button', { name: '取消任務' }))
    expect(onCancel).not.toHaveBeenCalled()
    const confirmButton = screen.getByRole('button', { name: '確認取消' })
    expect(confirmButton).toHaveFocus()
    fireEvent.click(confirmButton)

    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('task-1'))
  })

  it('唯讀協作者 -> 即使任務可取消也不顯示取消操作', () => {
    renderCard(job({ status: 'queued', canCancel: true }), { allowCancel: false })

    expect(screen.getByText('排隊中')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消任務' })).not.toBeInTheDocument()
  })

  it('已取消且帳務回滾失敗 -> 保持中性取消狀態並獨立警示帳務', () => {
    renderCard(job({
      status: 'cancelled',
      billingStatus: 'failed',
      refund: { status: 'failed', amount: null },
      error: null,
    }))

    expect(screen.getByText('已取消')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('預留費用回滾失敗')
    expect(screen.queryByText(/^錯誤：/)).not.toBeInTheDocument()
  })

  it('English locale -> technical metadata and missing billing remain explicit', () => {
    renderCard(job({
      model: null,
      billingStatus: 'unknown',
      cost: { estimated: null, actual: null, currency: 'CNY' },
    }), { locale: 'en' })

    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getAllByText('Not recorded')).toHaveLength(2)
    fireEvent.click(screen.getByText('Technical details'))
    expect(screen.getByText('Attempts')).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('Current stage')).toBeInTheDocument()
  })
})
