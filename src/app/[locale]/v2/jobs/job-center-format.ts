import type {
  JobBillingStatus,
  JobStatus,
  JobStatusFilter,
  JobView,
} from '@/lib/task/job-view'
import type { JobStatus as JobCardStatus } from '@/components/v2/JobCard'

export type JobCategory = 'image' | 'video' | 'voice' | 'analysis' | 'text' | 'other'
export type JobCenterFilter = 'all' | JobStatusFilter

export type JobCostPresentation =
  | { kind: 'free'; amount: null }
  | { kind: 'actual'; amount: string }
  | { kind: 'estimated'; amount: string }
  | { kind: 'unknown'; amount: null }

const IMAGE_MARKERS = [
  'image',
  'panel_variant',
  'insert_panel',
  'regenerate_group',
  'appearance',
  'location',
  'character',
  'asset_hub_modify',
] as const

const TEXT_MARKERS = [
  'script',
  'screenplay',
  'storyboard',
  'text',
  'prompt',
  'episode_split',
  'profile_confirm',
  'director_',
] as const

export function jobCategory(type: string): JobCategory {
  const normalized = type.toLowerCase()
  if (normalized.includes('video') || normalized.includes('lip_sync') || normalized.includes('stitch')) {
    return 'video'
  }
  if (normalized.includes('voice') || normalized.includes('tts')) return 'voice'
  if (normalized.includes('analyze')) return 'analysis'
  if (IMAGE_MARKERS.some((marker) => normalized.includes(marker))) return 'image'
  if (TEXT_MARKERS.some((marker) => normalized.includes(marker))) return 'text'
  return 'other'
}

export function toJobCardStatus(status: JobStatus): JobCardStatus {
  if (status === 'running') return 'running'
  if (status === 'completed') return 'succeeded'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'failed') return 'failed'
  if (status === 'queued') return 'queued'
  // Dismissed jobs are terminal failed jobs hidden by the canonical default
  // query. If explicitly returned, preserve that failure semantics.
  return 'failed'
}

export function formatJobMoney(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)
}

export function jobCostPresentation(job: JobView, locale: string): JobCostPresentation {
  const { billingStatus } = job
  if (billingStatus === 'not_billable' || billingStatus === 'skipped') {
    return { kind: 'free', amount: null }
  }
  if (billingStatus === 'charged' && job.cost.actual !== null) {
    return {
      kind: 'actual',
      amount: formatJobMoney(job.cost.actual, job.cost.currency, locale),
    }
  }
  if (job.cost.estimated !== null) {
    return {
      kind: 'estimated',
      amount: formatJobMoney(job.cost.estimated, job.cost.currency, locale),
    }
  }
  return { kind: 'unknown', amount: null }
}

export function formatJobDate(value: string | null, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(
    locale.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN',
    {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    },
  ).format(date)
}

export function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null
  const totalSeconds = Math.round(durationMs / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export function shortIdentifier(value: string, maximum = 14): string {
  if (value.length <= maximum) return value
  return `${value.slice(0, maximum)}…`
}

export function isActiveJobStatus(status: JobStatus): boolean {
  return status === 'queued' || status === 'running'
}

export function isRefundedBillingStatus(status: JobBillingStatus): boolean {
  return status === 'refunded'
}
