'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Modal } from '@/components/v2/Modal'
import { JobCard } from '@/components/v2/JobCard'
import { JobCenterCard } from '@/app/[locale]/v2/jobs/JobCenterCard'
import type { JobView } from '@/lib/task/job-view'
import {
  summarizeStoryboardBatchVideoRun,
  type StoryboardBatchJobsLoadState,
  type StoryboardBatchVideoState,
} from './storyboard-batch-video-state'

export interface StoryboardBatchVideoRunSheetProps {
  open: boolean
  state: StoryboardBatchVideoState
  jobs: JobView[]
  locale: string
  canEdit: boolean
  online: boolean
  jobsLoadState: StoryboardBatchJobsLoadState
  episodeMismatch: boolean
  onClose: () => void
  onConfirm: () => void
  onRequestQuote: () => void
  onRefreshJobs: () => void
  onCancelJob: (taskId: string) => Promise<unknown>
}

function formatMoney(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-TW' : locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`
}

export function StoryboardBatchVideoRunSheet({
  open,
  state,
  jobs,
  locale,
  canEdit,
  online,
  jobsLoadState,
  episodeMismatch,
  onClose,
  onConfirm,
  onRequestQuote,
  onRefreshJobs,
  onCancelJob,
}: StoryboardBatchVideoRunSheetProps) {
  const t = useTranslations('v2Storyboard.batchVideoRun')
  const summary = useMemo(
    () => summarizeStoryboardBatchVideoRun(state, jobs),
    [state, jobs],
  )
  const jobById = useMemo(
    () => new Map(jobs.map((job) => [job.id, job])),
    [jobs],
  )
  const quote = state.quote
  const isSubmitting = state.phase === 'submitting'
  const isTracking = state.phase === 'tracking' || state.phase === 'outcome_unknown'
  const jobsStale = jobsLoadState === 'stale'
  const priceUnavailable = !!quote && quote.newTasks > 0 && quote.estimatedTotalCost === null
  const subtitle = isTracking ? t('subtitleTracking') : t('subtitleQuote')
  const estimate = quote?.estimatedTotalCost === null || quote?.estimatedTotalCost === undefined
    ? null
    : formatMoney(quote.estimatedTotalCost, quote.currency, locale)
  const perTaskEstimate = quote?.estimatedCostPerTask === null || quote?.estimatedCostPerTask === undefined
    ? null
    : formatMoney(quote.estimatedCostPerTask, quote.currency, locale)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      dismissOnBackdrop={!isSubmitting}
      dismissOnEscape={!isSubmitting}
      className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-h-[86dvh]"
    >
      <Modal.Header
        heading={t('title')}
        subtitle={subtitle}
        onClose={onClose}
        closeAriaLabel={t('close')}
        showClose={!isSubmitting}
      />
      <Modal.Body className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-4 sm:p-5">
        {!online ? (
          <div role="alert" className="mb-4 rounded-[12px] border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[13px] leading-5 text-amber-100">
            {t('offline')}
          </div>
        ) : jobsLoadState === 'error' ? (
          <div role="alert" className="mb-4 flex flex-col gap-2 rounded-[12px] border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-[13px] leading-5 text-red-100 sm:flex-row sm:items-center sm:justify-between">
            <span>{t('jobsLoadError')}</span>
            <button type="button" onClick={onRefreshJobs} className="min-h-11 rounded-input border border-red-300/30 px-3 font-semibold">
              {t('refresh')}
            </button>
          </div>
        ) : jobsStale ? (
          <div role="alert" className="mb-4 flex flex-col gap-2 rounded-[12px] border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[13px] leading-5 text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <span>{t('stale')}</span>
            <button type="button" onClick={onRefreshJobs} className="min-h-11 rounded-input border border-amber-300/30 px-3 font-semibold">
              {t('refresh')}
            </button>
          </div>
        ) : null}

        {episodeMismatch && quote ? (
          <div role="alert" className="mb-4 rounded-[12px] border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[13px] leading-5 text-amber-100">
            {t('episodeMismatch', { episode: shortId(quote.episodeId) })}
          </div>
        ) : null}

        {priceUnavailable ? (
          <div role="alert" className="mb-4 rounded-[12px] border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-[13px] leading-5 text-red-100">
            {t('priceUnavailable')}
          </div>
        ) : null}

        {online && jobsLoadState === 'loading' && isTracking ? (
          <div role="status" aria-live="polite" className="mb-4 text-[13px] leading-5 text-text-secondary">
            {t('jobsLoading')}
          </div>
        ) : null}

        {!canEdit ? (
          <div className="mb-4 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[13px] leading-5 text-text-secondary">
            {t('viewer')}
          </div>
        ) : null}

        {state.phase === 'quoting' ? (
          <div role="status" aria-live="polite" className="rounded-[14px] border border-primary-500/25 bg-primary-900/20 px-4 py-6 text-center text-sm text-primary-200">
            {t('quoting')}
          </div>
        ) : null}

        {quote && (state.phase === 'quoted' || state.phase === 'submitting') ? (
          <section aria-label={t('subtitleQuote')} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-[14px] border border-border-soft bg-raised p-4">
                <div className="font-mono text-[12px] uppercase tracking-[0.16em] text-text-tertiary">
                  {t('targetCount', { count: quote.total })}
                </div>
                <div className="mt-3 break-all text-sm font-semibold text-text-primary">{quote.videoModel}</div>
                <div className="mt-1 text-xs text-text-tertiary">{t('model')}</div>
              </div>
              <div className="rounded-[14px] border border-primary-500/25 bg-primary-900/20 p-4">
                <div className="font-mono text-[12px] uppercase tracking-[0.16em] text-primary-300">
                  {t('estimatedMaximum')}
                </div>
                <div className="mt-2 font-heading text-2xl font-semibold text-text-primary">
                  {estimate ?? t('costUnavailable')}
                </div>
                {perTaskEstimate ? (
                  <div className="mt-1 text-xs text-text-secondary">{t('perTask', { amount: perTaskEstimate })}</div>
                ) : null}
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-3">
              <div className="rounded-[12px] border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2.5">
                <dt className="text-text-tertiary">{t('newTasksLabel')}</dt>
                <dd className="mt-1 font-mono text-base font-semibold text-emerald-200">{quote.newTasks}</dd>
              </div>
              <div className="rounded-[12px] border border-sky-400/20 bg-sky-400/[0.06] px-3 py-2.5">
                <dt className="text-text-tertiary">{t('alreadyActiveLabel')}</dt>
                <dd className="mt-1 font-mono text-base font-semibold text-sky-200">{quote.alreadyActive}</dd>
              </div>
              <div className="rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <dt className="text-text-tertiary">{t('skippedLabel')}</dt>
                <dd className="mt-1 font-mono text-base font-semibold text-text-primary">{quote.skipped}</dd>
                <div className="mt-1 text-[11px] leading-4 text-text-tertiary">
                  {t('skippedDetail', {
                    missingImage: quote.skippedMissingImage,
                    hasVideo: quote.skippedHasVideo,
                  })}
                </div>
              </div>
            </dl>
            {quote.total === 0 ? (
              <div className="rounded-[12px] border border-border-soft bg-raised/60 px-4 py-5 text-sm text-text-secondary">
                {t('empty')}
              </div>
            ) : null}
          </section>
        ) : null}

        {state.phase === 'error' ? (
          <div role="alert" className="rounded-[12px] border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-[13px] leading-5 text-red-100">
            {t('quoteFailed', { message: state.error ?? '' })}
          </div>
        ) : null}

        {state.phase === 'outcome_unknown' ? (
          <section className="space-y-3">
            <div role="alert" className="rounded-[12px] border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-[13px] leading-5 text-amber-100">
              {t('outcomeUnknown')}
            </div>
            <div role="status" aria-live="polite" className="text-[13px] leading-5 text-text-secondary">
              {jobs.length > 0
                ? t('reconciledJobs', { count: jobs.length })
                : t('reconcilingNoJobs')}
            </div>
            {jobs.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {jobs.map((job) => (
                  <JobCenterCard
                    key={job.id}
                    job={job}
                    locale={locale}
                    allowCancel={canEdit && online && jobsLoadState === 'fresh'}
                    onCancel={onCancelJob}
                  />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {state.submission ? (
          <section className="space-y-4">
            <div
              role="status"
              aria-live="polite"
              className="rounded-[12px] border border-border-soft bg-raised/70 px-3 py-2.5 font-mono text-[12px] tracking-wide text-text-secondary"
            >
              {summary.outcome === 'completed'
                ? t('allCompleted')
                : t('summary', {
                    active: summary.active,
                    completed: summary.completed,
                    failed: summary.failed,
                    cancelled: summary.cancelled,
                  })}
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {state.submission.items.map((item) => {
                const job = item.taskId ? jobById.get(item.taskId) : undefined
                if (job) {
                  return (
                    <JobCenterCard
                      key={item.panelId}
                      job={job}
                      locale={locale}
                      allowCancel={canEdit && online && jobsLoadState === 'fresh'}
                      onCancel={onCancelJob}
                    />
                  )
                }
                if (item.outcome === 'rejected') {
                  return (
                    <JobCard
                      key={item.panelId}
                      appearance="editor"
                      title={t('panelTask', { id: shortId(item.panelId) })}
                      status="failed"
                      model={quote?.videoModel ?? '—'}
                      cost={perTaskEstimate}
                      error={t('submissionRejected', { message: item.error?.message ?? '' })}
                    />
                  )
                }
                return (
                  <JobCard
                    key={item.panelId}
                    appearance="editor"
                    title={t('panelTask', { id: shortId(item.panelId) })}
                    status="queued"
                    model={quote?.videoModel ?? '—'}
                    cost={perTaskEstimate}
                    statusDetail={t('awaitingTask')}
                  />
                )
              })}
            </div>
          </section>
        ) : null}
      </Modal.Body>
      <Modal.Footer className="flex-col-reverse items-stretch sm:flex-row sm:items-center">
        <button type="button" onClick={onClose} disabled={isSubmitting} className="min-h-11 rounded-input border border-border-strong px-4 text-sm font-semibold text-text-secondary disabled:opacity-50">
          {t('close')}
        </button>
        {state.phase === 'error' ? (
          <button type="button" onClick={onRequestQuote} disabled={!online} className="min-h-11 rounded-input bg-primary-500 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {t('retryQuote')}
          </button>
        ) : null}
        {state.phase === 'outcome_unknown' ? (
          <button type="button" onClick={onRefreshJobs} disabled={!online} className="min-h-11 rounded-input bg-primary-500 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {t('refresh')}
          </button>
        ) : null}
        {state.phase === 'tracking' &&
        summary.active === 0 &&
        summary.failed + summary.cancelled > 0 &&
        canEdit ? (
          <p className="max-w-xl text-[12px] leading-5 text-text-tertiary">
            {t('retryFailedUnavailable')}
          </p>
        ) : null}
        {(state.phase === 'quoted' || state.phase === 'submitting') && canEdit && quote && quote.total > 0 ? (
          <button
            type="button"
            data-initial-focus
            onClick={onConfirm}
            disabled={!online || isSubmitting || episodeMismatch || priceUnavailable}
            className="min-h-11 rounded-input bg-primary-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? t('confirming') : t('confirm')}
          </button>
        ) : null}
      </Modal.Footer>
    </Modal>
  )
}
