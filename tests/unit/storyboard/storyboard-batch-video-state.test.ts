import { describe, expect, it } from 'vitest'
import {
  classifyStoryboardBatchVideoSubmitError,
  collectTerminalPanelVideoIds,
  initialStoryboardBatchVideoState,
  releaseTerminalPanelInFlightIds,
  resolveStoryboardBatchVideoEpisodeContext,
  resolveStoryboardBatchJobsLoadState,
  selectStoryboardBatchVideoJobs,
  storyboardBatchVideoReducer,
  summarizeStoryboardBatchVideoRun,
} from '@/app/[locale]/v2/workspace/[projectId]/storyboard/storyboard-batch-video-state'

const quote = {
  kind: 'quote' as const,
  batchRunId: 'batch-1',
  quotedAt: '2026-08-10T10:00:00.000Z',
  quoteFingerprint: 'v1.cXVvdGU.c2lnbmF0dXJl',
  episodeId: 'episode-1',
  videoModel: 'fal::video-model',
  currency: 'CNY' as const,
  estimatedCostPerTask: 2,
  estimatedTotalCost: 4,
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

describe('storyboard batch video reducer', () => {
  it('報價 -> 確認 -> partial response 保留逐項結果，不顯示假成功', () => {
    const quoting = storyboardBatchVideoReducer(initialStoryboardBatchVideoState, {
      type: 'quote_started',
    })
    const quoted = storyboardBatchVideoReducer(quoting, { type: 'quote_received', quote })
    const submitting = storyboardBatchVideoReducer(quoted, { type: 'submit_started' })
    const tracking = storyboardBatchVideoReducer(submitting, {
      type: 'submit_received',
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
          { panelId: 'panel-2', outcome: 'rejected', taskId: null, status: null, error: { code: 'SUBMIT_FAILED', message: 'provider unavailable' } },
        ],
      },
    })

    expect(tracking.phase).toBe('tracking')
    expect(tracking.submission?.outcome).toBe('partial')
    expect(summarizeStoryboardBatchVideoRun(tracking, [])).toEqual({
      total: 2,
      queued: 1,
      running: 0,
      completed: 0,
      failed: 1,
      cancelled: 0,
      active: 1,
      terminal: 1,
      outcome: 'partial',
    })
  })

  it('submit response 遺失 -> outcome_unknown 且不清掉原 quote', () => {
    const quoted = storyboardBatchVideoReducer(
      { ...initialStoryboardBatchVideoState, phase: 'quoting' },
      { type: 'quote_received', quote },
    )
    const unknown = storyboardBatchVideoReducer(
      storyboardBatchVideoReducer(quoted, { type: 'submit_started' }),
      { type: 'submit_outcome_unknown', message: 'Failed to fetch' },
    )

    expect(unknown.phase).toBe('outcome_unknown')
    expect(unknown.quote).toEqual(quote)
    expect(unknown.submission).toBeNull()
  })

  it('JobView cancelled/refunded -> cancelled 不可被歸類為 failed', () => {
    const state = storyboardBatchVideoReducer(
      { ...initialStoryboardBatchVideoState, phase: 'quoting' },
      { type: 'quote_received', quote },
    )
    const tracking = storyboardBatchVideoReducer(
      storyboardBatchVideoReducer(state, { type: 'submit_started' }),
      {
        type: 'submit_received',
        submission: {
          kind: 'submission',
          batchRunId: quote.batchRunId,
          quoteFingerprint: quote.quoteFingerprint,
          total: 2,
          accepted: 2,
          deduped: 0,
          rejected: 0,
          outcome: 'accepted',
          items: [
            { panelId: 'panel-1', outcome: 'accepted', taskId: 'task-1', status: 'queued', error: null },
            { panelId: 'panel-2', outcome: 'accepted', taskId: 'task-2', status: 'queued', error: null },
          ],
        },
      },
    )

    const summary = summarizeStoryboardBatchVideoRun(tracking, [
      { id: 'task-1', status: 'cancelled' },
      { id: 'task-2', status: 'completed' },
    ])
    expect(summary.cancelled).toBe(1)
    expect(summary.failed).toBe(0)
    expect(summary.completed).toBe(1)
    expect(summary.outcome).toBe('partial')
  })

  it('submit network、HTTP 5xx 與 malformed 2xx 都視為 outcome unknown；只有明確 4xx 可重試報價', () => {
    expect(classifyStoryboardBatchVideoSubmitError(new TypeError('Failed to fetch'))).toBe('outcome_unknown')
    expect(classifyStoryboardBatchVideoSubmitError(Object.assign(new Error('upstream'), { status: 503 }))).toBe('outcome_unknown')
    expect(classifyStoryboardBatchVideoSubmitError(new SyntaxError('invalid response payload'))).toBe('outcome_unknown')
    expect(classifyStoryboardBatchVideoSubmitError(Object.assign(new Error('stale'), { status: 409 }))).toBe('known_rejection')
  })

  it('outcome unknown 只接回同 batchRunId 或 quote 已知 active task，不吸附同 panel 的歷史任務', () => {
    const state = {
      ...initialStoryboardBatchVideoState,
      phase: 'outcome_unknown' as const,
      quote: {
        ...quote,
        targets: [
          { panelId: 'panel-1', disposition: 'new' as const, taskId: null, status: null },
          { panelId: 'panel-2', disposition: 'already_active' as const, taskId: 'task-active-before-quote', status: 'processing' },
        ],
      },
    }
    const jobs = [
      { id: 'task-historical', targetId: 'panel-1', batchRunId: 'old-batch', status: 'failed' },
      { id: 'task-current', targetId: 'panel-1', batchRunId: 'batch-1', status: 'queued' },
      { id: 'task-active-before-quote', targetId: 'panel-2', batchRunId: null, status: 'running' },
    ]

    expect(selectStoryboardBatchVideoJobs(state, jobs).map((job) => job.id)).toEqual([
      'task-current',
      'task-active-before-quote',
    ])
  })

  it('初次載入失敗與有 cache 後刷新失敗分成 error / stale', () => {
    expect(resolveStoryboardBatchJobsLoadState({ hasData: false, isPending: false, isError: true })).toBe('error')
    expect(resolveStoryboardBatchJobsLoadState({ hasData: true, isPending: false, isError: true })).toBe('stale')
    expect(resolveStoryboardBatchJobsLoadState({ hasData: false, isPending: true, isError: false })).toBe('loading')
    expect(resolveStoryboardBatchJobsLoadState({ hasData: true, isPending: false, isError: false })).toBe('fresh')
  })

  it('failed/cancelled URL-less panel 不會永久留在 local in-flight；仍有 server active 的保留', () => {
    expect(collectTerminalPanelVideoIds([
      { type: 'video_panel', targetType: 'NovelPromotionPanel', targetId: 'failed-panel', status: 'failed', errorCode: 'PROVIDER_FAILED' },
      { type: 'video_panel', targetType: 'NovelPromotionPanel', targetId: 'cancelled-panel', status: 'failed', errorCode: 'TASK_CANCELLED' },
      { type: 'video_panel', targetType: 'NovelPromotionPanel', targetId: 'active-panel', status: 'processing', errorCode: null },
    ])).toEqual(new Set(['failed-panel', 'cancelled-panel']))
    expect(releaseTerminalPanelInFlightIds(
      new Set(['failed-panel', 'active-panel', 'pending-panel']),
      new Set(['active-panel']),
      new Set(['failed-panel', 'active-panel']),
    )).toEqual(new Set(['active-panel', 'pending-panel']))
  })

  it('A 集 quote 在切到 B 集後仍 pin A 查詢，且禁止用 B 確認 A', () => {
    const state = {
      ...initialStoryboardBatchVideoState,
      phase: 'outcome_unknown' as const,
      quote,
    }
    expect(resolveStoryboardBatchVideoEpisodeContext('episode-2', state)).toEqual({
      pinnedEpisodeId: 'episode-1',
      episodeMismatch: true,
    })
    expect(resolveStoryboardBatchVideoEpisodeContext('episode-1', state)).toEqual({
      pinnedEpisodeId: 'episode-1',
      episodeMismatch: false,
    })
  })
})
