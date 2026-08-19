import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import zhStoryboard from '../../../messages/zh/v2Storyboard.json'
import zhJobs from '../../../messages/zh/v2Jobs.json'
import { StoryboardBatchVideoRunSheet } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/StoryboardBatchVideoRunSheet'
import type { StoryboardBatchVideoState } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/storyboard-batch-video-state'

const quote = {
  kind: 'quote' as const,
  batchRunId: 'batch-1',
  quotedAt: '2026-08-10T10:00:00.000Z',
  quoteFingerprint: 'v1.cXVvdGU.c2lnbmF0dXJl',
  episodeId: 'episode-1',
  videoModel: 'fal::video-model',
  currency: 'CNY' as const,
  estimatedCostPerTask: 2.5,
  estimatedTotalCost: 5,
  targets: [
    { panelId: 'panel-1', disposition: 'new' as const, taskId: null, status: null },
    { panelId: 'panel-2', disposition: 'new' as const, taskId: null, status: null },
  ],
  total: 2,
  newTasks: 2,
  alreadyActive: 0,
  skipped: 0,
  skippedMissingImage: 0,
  skippedHasVideo: 0,
}

const quotedState: StoryboardBatchVideoState = {
  phase: 'quoted',
  quote,
  submission: null,
  error: null,
}

function renderSheet(overrides: Partial<React.ComponentProps<typeof StoryboardBatchVideoRunSheet>> = {}) {
  const props: React.ComponentProps<typeof StoryboardBatchVideoRunSheet> = {
    open: true,
    state: quotedState,
    jobs: [],
    locale: 'zh',
    canEdit: true,
    online: true,
    jobsLoadState: 'fresh',
    episodeMismatch: false,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    onRequestQuote: vi.fn(),
    onRefreshJobs: vi.fn(),
    onCancelJob: vi.fn(async () => undefined),
    ...overrides,
  }
  render(
    <NextIntlClientProvider
      locale="zh"
      messages={{ v2Storyboard: zhStoryboard, v2Jobs: zhJobs }}
    >
      <StoryboardBatchVideoRunSheet {...props} />
    </NextIntlClientProvider>,
  )
  return props
}

describe('StoryboardBatchVideoRunSheet', () => {
  it('390-friendly quote -> dialog 無固定寬度並在確認前顯示鏡數與最高費用', () => {
    const props = renderSheet()

    const dialog = screen.getByRole('dialog', { name: '批次影片任務' })
    const panel = dialog.firstElementChild
    expect(panel).toHaveClass('w-full')
    expect(panel).toHaveClass('max-h-[calc(100dvh-2rem)]')
    expect(screen.getByText('2 個分鏡')).toBeInTheDocument()
    expect(screen.getByText('這次新建任務').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText(/CNY\s*5\.00/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '確認並送出' }))
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('viewer role -> 可讀報價但沒有確認或取消 mutation 操作', () => {
    renderSheet({ canEdit: false })

    expect(screen.getByText(/你目前是唯讀協作者/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '確認並送出' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消任務' })).not.toBeInTheDocument()
  })

  it('offline -> 保留 quote、顯示明確警示並停用確認', () => {
    renderSheet({ online: false })

    expect(screen.getByRole('alert')).toHaveTextContent('目前離線')
    expect(screen.getByRole('button', { name: '確認並送出' })).toBeDisabled()
    expect(screen.getByText('2 個分鏡')).toBeInTheDocument()
  })

  it('有新任務但缺少可靠價格 -> 明確阻擋確認與送出', () => {
    const props = renderSheet({
      state: {
        ...quotedState,
        quote: { ...quote, estimatedTotalCost: null },
      },
    })

    expect(screen.getByRole('alert')).toHaveTextContent('無法取得可靠的最高費用')
    const confirm = screen.getByRole('button', { name: '確認並送出' })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('A 集 quote 切到 B 集後明示切回，且禁止確認', () => {
    const props = renderSheet({ episodeMismatch: true })

    expect(screen.getByRole('alert')).toHaveTextContent('請切回原本報價的集數')
    expect(screen.getByRole('button', { name: '確認並送出' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '確認並送出' }))
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('jobs 初載失敗與 cached stale 顯示不同訊息', () => {
    renderSheet({ jobsLoadState: 'error' })
    expect(screen.getByRole('alert')).toHaveTextContent('尚未取得任何可安全顯示的快取資料')
    cleanup()

    renderSheet({ jobsLoadState: 'stale' })
    expect(screen.getByRole('alert')).toHaveTextContent('任務狀態可能不是最新資料')
  })

  it('partial submission -> aria-live 如實顯示完成前的 active/failed 數量', () => {
    const state: StoryboardBatchVideoState = {
      phase: 'tracking',
      quote,
      error: null,
      submission: {
        kind: 'submission',
        batchRunId: quote.batchRunId,
        quoteFingerprint: quote.quoteFingerprint,
        total: 2,
        accepted: 1,
        deduped: 0,
        rejected: 1,
        outcome: 'partial',
        items: [
          { panelId: 'panel-1', outcome: 'accepted', taskId: 'task-1', status: 'queued', error: null },
          { panelId: 'panel-2', outcome: 'rejected', taskId: null, status: null, error: { code: 'QUEUE_DOWN', message: 'queue unavailable' } },
        ],
      },
    }
    renderSheet({ state })

    expect(screen.getByRole('status')).toHaveTextContent('進行中 1')
    expect(screen.getByRole('status')).toHaveTextContent('失敗 1')
    expect(screen.getByRole('alert')).toHaveTextContent('queue unavailable')
    expect(screen.queryByText('全部完成')).not.toBeInTheDocument()
  })

  it('全部 terminal 且有失敗 -> 明說 failed-only retry 尚不可用，不顯示會直接重送的按鈕', () => {
    const state: StoryboardBatchVideoState = {
      phase: 'tracking',
      quote: { ...quote, total: 1, newTasks: 1, targets: [quote.targets[0]] },
      error: null,
      submission: {
        kind: 'submission',
        batchRunId: quote.batchRunId,
        quoteFingerprint: quote.quoteFingerprint,
        total: 1,
        accepted: 0,
        deduped: 0,
        rejected: 1,
        outcome: 'failed',
        items: [
          { panelId: 'panel-1', outcome: 'rejected', taskId: null, status: null, error: { code: 'QUEUE_DOWN', message: 'down' } },
        ],
      },
    }
    const props = renderSheet({ state })

    expect(screen.getByText(/尚未支援在同一批次內只重試失敗項目/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重試失敗/ })).not.toBeInTheDocument()
    expect(props.onRequestQuote).not.toHaveBeenCalled()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})
