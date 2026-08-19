'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import { useTranslations } from 'next-intl'

export type JobStatus =
  | 'estimated'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded'

export type JobCardAppearance = 'production' | 'editor'

export interface JobCardLabels {
  status: Record<JobStatus, ReactNode>
  model: ReactNode
  missingCost: ReactNode
  progress: ReactNode
  waitingProgress: ReactNode
  errorPrefix: ReactNode
  defaultError: ReactNode
  refundPrefix: ReactNode
  defaultRefund: ReactNode
}

export type JobCardLabelOverrides = Partial<Omit<JobCardLabels, 'status'>> & {
  status?: Partial<Record<JobStatus, ReactNode>>
}

export interface JobCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** A concise, user-facing name for the generation job. */
  title: ReactNode
  status: JobStatus
  /** Provider/model label supplied by the caller. */
  model: ReactNode
  /** Already-formatted cost, or null while the provider has not reported it. */
  cost?: ReactNode
  costLabel?: ReactNode
  /** Provider-reported progress from 0–100. Values outside the range are clamped. */
  progress?: number
  statusDetail?: ReactNode
  error?: ReactNode
  refund?: ReactNode
  preview?: ReactNode
  details?: ReactNode
  primaryAction?: ReactNode
  secondaryActions?: ReactNode
  appearance?: JobCardAppearance
  labels?: JobCardLabelOverrides
}

interface StatusPresentation {
  symbol: string
  tone: 'neutral' | 'info' | 'active' | 'success' | 'danger' | 'warning'
}

const statusPresentation: Record<JobStatus, StatusPresentation> = {
  estimated: { symbol: '≈', tone: 'neutral' },
  queued: { symbol: '…', tone: 'info' },
  running: { symbol: '↻', tone: 'active' },
  succeeded: { symbol: '✓', tone: 'success' },
  failed: { symbol: '!', tone: 'danger' },
  cancelled: { symbol: '×', tone: 'warning' },
  refunded: { symbol: '↩', tone: 'success' },
}

const productionStatusClasses: Record<StatusPresentation['tone'], string> = {
  neutral: 'border-white/10 bg-white/[0.05] text-[var(--production-ink-muted)]',
  info: 'border-[var(--process-cyan)]/30 bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
  active: 'border-[var(--process-cyan)]/45 bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
  success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  danger: 'border-red-400/25 bg-red-400/10 text-red-200',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
}

const editorStatusClasses: Record<StatusPresentation['tone'], string> = {
  neutral: 'border-white/10 bg-white/[0.05] text-[var(--text-secondary)]',
  info: 'border-[var(--process-cyan)]/30 bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
  active: 'border-[var(--process-cyan)]/45 bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
  success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  danger: 'border-red-400/25 bg-red-400/10 text-red-200',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.min(100, Math.max(0, Math.round(progress)))
}

export function JobCard({
  title,
  status,
  model,
  cost,
  costLabel,
  progress,
  statusDetail,
  error,
  refund,
  preview,
  details,
  primaryAction,
  secondaryActions,
  appearance = 'production',
  labels,
  className,
  ...rest
}: JobCardProps) {
  const t = useTranslations('v2Jobs.card')
  const presentation = statusPresentation[status]
  const statusLabel = labels?.status?.[status] ?? t(`status.${status}`)
  const modelLabel = labels?.model ?? t('model')
  const resolvedCostLabel = costLabel ?? t('cost')
  const missingCostLabel = labels?.missingCost ?? t('notRecorded')
  const progressLabel = labels?.progress ?? t('progress')
  const waitingProgressLabel = labels?.waitingProgress ?? t('waitingProgress')
  const errorPrefix = labels?.errorPrefix ?? t('errorPrefix')
  const defaultError = labels?.defaultError ?? t('defaultError')
  const refundPrefix = labels?.refundPrefix ?? t('refundPrefix')
  const defaultRefund = labels?.defaultRefund ?? t('refundComplete')
  const normalizedProgress = progress === undefined ? undefined : clampProgress(progress)
  const isProduction = appearance === 'production'
  const showProgress = status === 'queued' || status === 'running' || normalizedProgress !== undefined

  const surfaceClasses = isProduction
    ? 'border-[var(--production-border)] bg-[var(--production-surface)] text-[var(--production-ink)]'
    : 'border-[var(--border-soft)] bg-[var(--surface-raised)] text-[var(--text-primary)]'
  const mutedTextClasses = isProduction
    ? 'text-[var(--production-ink-muted)]'
    : 'text-[var(--text-secondary)]'
  const dividerClasses = isProduction
    ? 'border-[var(--production-border)]'
    : 'border-[var(--border-soft)]'
  const statusClasses = isProduction
    ? productionStatusClasses[presentation.tone]
    : editorStatusClasses[presentation.tone]
  const trackClasses = isProduction
    ? 'bg-[var(--production-muted)]'
    : 'bg-[var(--surface-overlay)]'
  const progressClasses = 'bg-[var(--process-cyan)]'

  return (
    <article
      aria-label={typeof title === 'string' ? title : undefined}
      className={[
        'overflow-hidden rounded-[14px] border',
        surfaceClasses,
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {preview ? (
        <div className={['border-b', dividerClasses].join(' ')}>{preview}</div>
      ) : null}

      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold leading-6">{title}</h3>
            {statusDetail ? (
              <div className={['mt-1 text-[13px] leading-5', mutedTextClasses].join(' ')}>
                {statusDetail}
              </div>
            ) : null}
          </div>

          <span
            className={[
              'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1',
              'text-[12px] font-semibold leading-4',
              statusClasses,
            ].join(' ')}
          >
            <span aria-hidden="true" className="font-mono text-[13px] leading-none">
              {presentation.symbol}
            </span>
            <span>{statusLabel}</span>
          </span>
        </div>

        <dl className={['mt-4 grid grid-cols-1 gap-3 border-y py-3 sm:grid-cols-2', dividerClasses].join(' ')}>
          <div className="min-w-0">
            <dt className={['text-[12px] font-medium leading-4', mutedTextClasses].join(' ')}>{modelLabel}</dt>
            <dd className="mt-1 truncate text-[14px] font-medium leading-5">{model}</dd>
          </div>
          <div className="min-w-0 sm:text-right">
            <dt className={['text-[12px] font-medium leading-4', mutedTextClasses].join(' ')}>{resolvedCostLabel}</dt>
            <dd className="mt-1 text-[14px] font-semibold leading-5">
              {cost ?? <span className={mutedTextClasses}>{missingCostLabel}</span>}
            </dd>
          </div>
        </dl>

        {showProgress ? (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-[12px] leading-4">
              <span className={mutedTextClasses}>{progressLabel}</span>
              <span className="font-mono font-semibold">
                {normalizedProgress === undefined ? waitingProgressLabel : `${normalizedProgress}%`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={typeof progressLabel === 'string' ? progressLabel : undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={normalizedProgress}
              aria-valuetext={
                normalizedProgress === undefined && typeof waitingProgressLabel === 'string'
                  ? waitingProgressLabel
                  : `${normalizedProgress ?? 0}%`
              }
              className={['h-2 overflow-hidden rounded-full', trackClasses].join(' ')}
            >
              <div
                className={[
                  'h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none',
                  progressClasses,
                  normalizedProgress === undefined ? 'w-1/3 animate-pulse motion-reduce:animate-none' : '',
                ].filter(Boolean).join(' ')}
                style={normalizedProgress === undefined ? undefined : { width: `${normalizedProgress}%` }}
              />
            </div>
          </div>
        ) : null}

        {status === 'failed' || error ? (
          <div
            role="alert"
            className={[
              'mt-4 rounded-[10px] border px-3 py-2.5 text-[13px] leading-5',
              'border-red-400/25 bg-red-400/10 text-red-200',
            ].join(' ')}
          >
            <span className="font-semibold">{errorPrefix}</span>
            {error ?? defaultError}
          </div>
        ) : null}

        {status === 'refunded' || refund ? (
          <div
            className={[
              'mt-4 rounded-[10px] border px-3 py-2.5 text-[13px] leading-5',
              'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
            ].join(' ')}
          >
            <span className="font-semibold">{refundPrefix}</span>
            {refund ?? defaultRefund}
          </div>
        ) : null}

        {details ? (
          <div className={['mt-4 border-t pt-4', dividerClasses].join(' ')}>
            {details}
          </div>
        ) : null}

        {primaryAction || secondaryActions ? (
          <footer
            className={[
              'mt-4 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between',
              dividerClasses,
            ].join(' ')}
          >
            <div className="flex flex-wrap items-center gap-2 [&_a]:min-h-11 [&_button]:min-h-11">
              {secondaryActions}
            </div>
            <div className="flex items-center justify-end [&_a]:min-h-11 [&_button]:min-h-11">
              {primaryAction}
            </div>
          </footer>
        ) : null}
      </div>
    </article>
  )
}
