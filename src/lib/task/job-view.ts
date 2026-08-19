import type { Task } from '@prisma/client'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { normalizeTaskError } from '@/lib/errors/normalize'
import type { NormalizedError } from '@/lib/errors/types'
import { TASK_STATUS } from './types'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dismissed'

export type JobStatusFilter = 'active' | 'completed' | 'failed' | 'cancelled'

export type JobBillingStatus =
  | 'unknown'
  | 'not_billable'
  | 'skipped'
  | 'quoted'
  | 'reserved'
  | 'charged'
  | 'refunded'
  | 'failed'

export type JobRefundStatus = 'not_applicable' | 'not_refunded' | 'refunded' | 'failed'

export type JobView = {
  id: string
  type: string
  title: string
  typeLabel: string
  targetType: string
  targetId: string
  projectId: string
  episodeId: string | null
  /** Stable server-issued identity for reconciling a response-lost batch. */
  batchRunId?: string | null
  status: JobStatus
  progress: number
  model: string | null
  cost: {
    estimated: number | null
    actual: number | null
    currency: typeof BILLING_CURRENCY
  }
  billingStatus: JobBillingStatus
  refund: {
    status: JobRefundStatus
    amount: number | null
  }
  error: NormalizedError | null
  createdAt: string
  updatedAt: string
  queuedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  attempt: number
  maxAttempts: number
  stageLabel: string
  canCancel: boolean
}

type JobViewTask = Pick<
  Task,
  | 'id'
  | 'type'
  | 'targetType'
  | 'targetId'
  | 'projectId'
  | 'episodeId'
  | 'status'
  | 'progress'
  | 'payload'
  | 'billingInfo'
  | 'errorCode'
  | 'errorMessage'
  | 'createdAt'
  | 'updatedAt'
  | 'queuedAt'
  | 'startedAt'
  | 'finishedAt'
  | 'attempt'
  | 'maxAttempts'
>

type ParsedBillingInfo =
  | {
    billable: false
    status?: 'skipped'
  }
  | {
    billable: true
    model: string
    maxFrozenCost: number
    chargedCost?: number
    status?: 'skipped' | 'quoted' | 'frozen' | 'settled' | 'rolled_back' | 'failed'
  }

const BILLABLE_STATUSES = new Set([
  'skipped',
  'quoted',
  'frozen',
  'settled',
  'rolled_back',
  'failed',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseBillingInfo(value: unknown): ParsedBillingInfo | null {
  if (!isRecord(value) || typeof value.billable !== 'boolean') return null
  if (!value.billable) {
    return {
      billable: false,
      ...(value.status === 'skipped' ? { status: 'skipped' as const } : {}),
    }
  }
  if (
    typeof value.model !== 'string' ||
    typeof value.maxFrozenCost !== 'number' ||
    (value.status !== undefined && (
      typeof value.status !== 'string' || !BILLABLE_STATUSES.has(value.status)
    )) ||
    (value.chargedCost !== undefined && typeof value.chargedCost !== 'number')
  ) {
    return null
  }
  return {
    billable: true,
    model: value.model,
    maxFrozenCost: value.maxFrozenCost,
    ...(typeof value.chargedCost === 'number' ? { chargedCost: value.chargedCost } : {}),
    ...(typeof value.status === 'string'
      ? { status: value.status as Exclude<ParsedBillingInfo, { billable: false }>['status'] }
      : {}),
  }
}

function toFiniteCost(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function toStatus(status: string, errorCode: string | null): JobStatus {
  if (status === TASK_STATUS.QUEUED) return 'queued'
  if (status === TASK_STATUS.PROCESSING) return 'running'
  if (status === TASK_STATUS.COMPLETED) return 'completed'
  if (status === TASK_STATUS.DISMISSED) return 'dismissed'
  if (status === TASK_STATUS.FAILED && errorCode === 'TASK_CANCELLED') return 'cancelled'
  return 'failed'
}

function toProgress(progress: number | null, status: JobStatus): number {
  if (status === 'completed') return 100
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return 0
  return Math.min(100, Math.max(0, Math.round(progress)))
}

function toTypeLabel(type: string): string {
  return type
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function toStageLabel(payload: unknown, status: JobStatus): string {
  const payloadObject = isRecord(payload) ? payload : null
  const projected = [payloadObject?.stageLabel, payloadObject?.stage]
    .find((value) => typeof value === 'string' && value.trim())
  if (typeof projected === 'string') {
    return projected.trim().slice(0, 160)
  }
  if (status === 'queued') return 'Queued'
  if (status === 'running') return 'Processing'
  if (status === 'completed') return 'Completed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'dismissed') return 'Dismissed'
  return 'Failed'
}

function toBillingStatus(info: ParsedBillingInfo | null): JobBillingStatus {
  if (!info) return 'unknown'
  if (!info.billable) return info.status === 'skipped' ? 'skipped' : 'not_billable'
  if (info.status === 'frozen') return 'reserved'
  if (info.status === 'settled') return 'charged'
  if (info.status === 'rolled_back') return 'refunded'
  return info.status || 'unknown'
}

function toRefundStatus(
  info: ParsedBillingInfo | null,
  errorCode: string | null,
): JobRefundStatus {
  if (!info || !info.billable) return 'not_applicable'
  if (info.status === 'rolled_back') return 'refunded'
  if (info.status === 'failed') return 'failed'
  // Legacy rows used the task error code as the only compensation-failure
  // marker. Keep reading them while new cancellations preserve TASK_CANCELLED
  // and project the independent billingInfo.status above.
  if (errorCode === 'BILLING_COMPENSATION_FAILED') return 'failed'
  return 'not_refunded'
}

function durationMs(startedAt: Date | null, finishedAt: Date | null): number | null {
  if (!startedAt || !finishedAt) return null
  return Math.max(0, finishedAt.getTime() - startedAt.getTime())
}

export function toJobView(task: JobViewTask): JobView {
  const status = toStatus(task.status, task.errorCode)
  const billingInfo = parseBillingInfo(task.billingInfo)
  const typeLabel = toTypeLabel(task.type)
  const estimated = billingInfo?.billable ? toFiniteCost(billingInfo.maxFrozenCost) : null
  const actual = billingInfo?.billable
    ? billingInfo.status === 'rolled_back' || billingInfo.status === 'skipped'
      ? 0
      : toFiniteCost(billingInfo.chargedCost)
    : billingInfo
      ? 0
      : null

  return {
    id: task.id,
    type: task.type,
    title: typeLabel,
    typeLabel,
    targetType: task.targetType,
    targetId: task.targetId,
    projectId: task.projectId,
    episodeId: task.episodeId,
    batchRunId: isRecord(task.payload) && typeof task.payload.batchRunId === 'string'
      ? task.payload.batchRunId
      : null,
    status,
    progress: toProgress(task.progress, status),
    model: billingInfo?.billable ? billingInfo.model : null,
    cost: {
      estimated,
      actual,
      currency: BILLING_CURRENCY,
    },
    billingStatus: toBillingStatus(billingInfo),
    refund: {
      status: toRefundStatus(billingInfo, task.errorCode),
      // The current ledger records rollback state but not a dedicated refund amount.
      // Keep this null rather than presenting the reservation as money returned.
      amount: null,
    },
    error: status === 'cancelled'
      ? null
      : normalizeTaskError(task.errorCode, task.errorMessage),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    queuedAt: toIsoString(task.queuedAt),
    startedAt: toIsoString(task.startedAt),
    finishedAt: toIsoString(task.finishedAt),
    durationMs: durationMs(task.startedAt, task.finishedAt),
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    stageLabel: toStageLabel(task.payload, status),
    canCancel: status === 'queued' || status === 'running',
  }
}
