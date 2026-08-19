'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { JobCard, type JobCardLabelOverrides } from '@/components/v2/JobCard'
import type { JobView } from '@/lib/task/job-view'
import {
  formatDuration,
  formatJobDate,
  formatJobMoney,
  isRefundedBillingStatus,
  jobCategory,
  jobCostPresentation,
  shortIdentifier,
  toJobCardStatus,
} from './job-center-format'

interface JobCenterCardProps {
  job: JobView
  locale: string
  allowCancel: boolean
  onCancel: (taskId: string) => Promise<unknown>
}

export function JobCenterCard({
  job,
  locale,
  allowCancel,
  onCancel,
}: JobCenterCardProps) {
  const t = useTranslations('v2Jobs.card')
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelFailed, setCancelFailed] = useState(false)
  const confirmCancelRef = useRef<HTMLButtonElement>(null)
  const category = jobCategory(job.type)
  const cost = jobCostPresentation(job, locale)
  const createdAt = formatJobDate(job.createdAt, locale)
  const startedAt = formatJobDate(job.startedAt, locale)
  const finishedAt = formatJobDate(job.finishedAt, locale)
  const duration = formatDuration(job.durationMs)
  const showCancel = allowCancel && job.canCancel
  const labels: JobCardLabelOverrides = {
    status: {
      estimated: t('status.estimated'),
      queued: t('status.queued'),
      running: t('status.running'),
      succeeded: t('status.succeeded'),
      failed: t('status.failed'),
      cancelled: t('status.cancelled'),
      refunded: t('status.refunded'),
    },
    model: t('model'),
    missingCost: t('notRecorded'),
    progress: t('progress'),
    waitingProgress: t('waitingProgress'),
    errorPrefix: t('errorPrefix'),
    defaultError: t('defaultError'),
    refundPrefix: t('refundPrefix'),
    defaultRefund: t('refundComplete'),
  }

  const costText = cost.kind === 'actual'
    ? t('actualCost', { amount: cost.amount })
    : cost.kind === 'estimated'
      ? t('estimatedCost', { amount: cost.amount })
      : cost.kind === 'free'
        ? t('free')
        : undefined

  useEffect(() => {
    if (confirmingCancel) confirmCancelRef.current?.focus()
  }, [confirmingCancel])

  async function confirmCancel() {
    setCancelFailed(false)
    setIsCancelling(true)
    try {
      await onCancel(job.id)
      setConfirmingCancel(false)
    } catch {
      setCancelFailed(true)
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <JobCard
      title={t(`category.${category}`)}
      status={toJobCardStatus(job.status)}
      model={job.model ?? t('notRecorded')}
      cost={costText}
      costLabel={t('cost')}
      progress={job.progress}
      statusDetail={t('target', {
        type: job.targetType,
        id: shortIdentifier(job.targetId),
      })}
      error={job.status === 'failed' ? job.error?.message ?? undefined : undefined}
      refund={
        isRefundedBillingStatus(job.billingStatus)
          ? job.refund.amount === null
            ? t('refundComplete')
            : t('refundAmount', {
                amount: formatJobMoney(job.refund.amount, job.cost.currency, locale),
              })
          : undefined
      }
      details={(
        <>
          {job.refund.status === 'failed' ? (
            <div role="alert" className="mb-3 rounded-[10px] border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[13px] leading-5 text-amber-100">
              {t('refundFailed')}
            </div>
          ) : null}
          <details className="group/details">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 text-[13px] font-semibold text-[var(--production-ink-muted)] transition-colors hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]">
              <span>{t('technicalDetails')}</span>
              <AppIcon
                name="chevronDown"
                className="h-4 w-4 transition-transform group-open/details:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <dl className="mt-3 grid gap-x-5 gap-y-3 rounded-xl bg-[var(--production-muted)] p-4 text-[12px] sm:grid-cols-2">
              <TechnicalRow label={t('taskId')} value={job.id} mono />
              <TechnicalRow label={t('taskType')} value={job.type} mono />
              {job.episodeId ? (
                <TechnicalRow label={t('episodeId')} value={job.episodeId} mono />
              ) : null}
              {createdAt ? <TechnicalRow label={t('createdAt')} value={createdAt} /> : null}
              {startedAt ? <TechnicalRow label={t('startedAt')} value={startedAt} /> : null}
              {finishedAt ? <TechnicalRow label={t('finishedAt')} value={finishedAt} /> : null}
              {duration ? <TechnicalRow label={t('duration')} value={duration} /> : null}
              <TechnicalRow
                label={t('attempt')}
                value={`${job.attempt}/${job.maxAttempts}`}
              />
              <TechnicalRow label={t('stage')} value={job.stageLabel} />
            </dl>
          </details>
        </>
      )}
      secondaryActions={showCancel ? (
        <div className="flex flex-wrap items-center gap-2">
          {confirmingCancel ? (
            <>
              <button
                ref={confirmCancelRef}
                type="button"
                disabled={isCancelling}
                onClick={() => void confirmCancel()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-400/35 bg-red-400/10 px-3 text-[13px] font-semibold text-red-200 transition-colors hover:bg-red-400/15 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
              >
                {isCancelling ? (
                  <AppIcon name="loader" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <AppIcon name="alert" className="h-4 w-4" />
                )}
                {isCancelling ? t('cancelling') : t('confirmCancel')}
              </button>
              <button
                type="button"
                disabled={isCancelling}
                onClick={() => {
                  setConfirmingCancel(false)
                  setCancelFailed(false)
                }}
                className="kuiper-dashboard-secondary min-h-11 px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
              >
                {t('keepRunning')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-400/30 px-3 text-[13px] font-semibold text-red-200 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
            >
              <AppIcon name="close" className="h-4 w-4" />
              {t('cancel')}
            </button>
          )}
          {cancelFailed ? (
            <span role="alert" className="text-[12px] leading-5 text-red-200">
              {t('cancelError')}
            </span>
          ) : null}
        </div>
      ) : undefined}
      labels={labels}
    />
  )
}

function TechnicalRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--production-ink-muted)]">{label}</dt>
      <dd
        className={`mt-1 break-all text-[var(--production-ink)] ${mono ? 'font-mono text-[11px]' : ''}`}
      >
        {value}
      </dd>
    </div>
  )
}
