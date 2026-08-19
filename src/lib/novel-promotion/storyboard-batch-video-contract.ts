import type { BillingCurrency } from '@/lib/billing/currency'

export type StoryboardBatchVideoQuote = {
  kind: 'quote'
  batchRunId: string
  quotedAt: string
  quoteFingerprint: string
  episodeId: string
  videoModel: string
  currency: BillingCurrency
  estimatedCostPerTask: number | null
  estimatedTotalCost: number | null
  targets: Array<{
    panelId: string
    disposition: 'new' | 'already_active'
    taskId: string | null
    status: string | null
  }>
  total: number
  newTasks: number
  alreadyActive: number
  skipped: number
  skippedMissingImage: number
  skippedHasVideo: number
}

export type StoryboardBatchVideoSubmissionItem = {
  panelId: string
  outcome: 'accepted' | 'deduped' | 'rejected'
  taskId: string | null
  status: string | null
  error: { code: string; message: string } | null
}

export type StoryboardBatchVideoSubmission = {
  kind: 'submission'
  batchRunId: string
  quoteFingerprint: string
  total: number
  accepted: number
  deduped: number
  rejected: number
  outcome: 'accepted' | 'partial' | 'failed'
  items: StoryboardBatchVideoSubmissionItem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSignedQuoteToken(value: unknown): value is string {
  return typeof value === 'string'
    && /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isNullableCost(value: unknown): value is number | null {
  return value === null || (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  )
}

function invalidQuote(reason: string): never {
  throw new Error(`Invalid storyboard batch video quote: ${reason}`)
}

function invalidSubmission(reason: string): never {
  throw new Error(`Invalid storyboard batch video submission: ${reason}`)
}

export function parseStoryboardBatchVideoQuote(
  value: unknown,
): StoryboardBatchVideoQuote {
  if (!isRecord(value) || value.kind !== 'quote') invalidQuote('kind')
  if (
    !isNonEmptyString(value.batchRunId) ||
    !isNonEmptyString(value.quotedAt) ||
    !Number.isFinite(Date.parse(value.quotedAt)) ||
    !isSignedQuoteToken(value.quoteFingerprint) ||
    !isNonEmptyString(value.episodeId) ||
    !isNonEmptyString(value.videoModel) ||
    value.currency !== 'CNY' ||
    !isNullableCost(value.estimatedCostPerTask) ||
    !isNullableCost(value.estimatedTotalCost) ||
    !Array.isArray(value.targets)
  ) {
    invalidQuote('identity, pricing, or targets')
  }

  const targets = value.targets.map((target, index) => {
    if (
      !isRecord(target) ||
      !isNonEmptyString(target.panelId) ||
      (target.disposition !== 'new' && target.disposition !== 'already_active')
    ) {
      invalidQuote(`target ${index}`)
    }
    if (
      target.disposition === 'new' &&
      (target.taskId !== null || target.status !== null)
    ) {
      invalidQuote(`new target ${index}`)
    }
    if (
      target.disposition === 'already_active' &&
      (!isNonEmptyString(target.taskId) || !isNonEmptyString(target.status))
    ) {
      invalidQuote(`active target ${index}`)
    }
    return {
      panelId: target.panelId,
      disposition: target.disposition,
      taskId: target.taskId,
      status: target.status,
    } as StoryboardBatchVideoQuote['targets'][number]
  })

  const countFields = [
    value.total,
    value.newTasks,
    value.alreadyActive,
    value.skipped,
    value.skippedMissingImage,
    value.skippedHasVideo,
  ]
  if (!countFields.every(isNonNegativeInteger)) invalidQuote('counts')
  const total = value.total as number
  const declaredNewTasks = value.newTasks as number
  const declaredAlreadyActive = value.alreadyActive as number
  const skipped = value.skipped as number
  const skippedMissingImage = value.skippedMissingImage as number
  const skippedHasVideo = value.skippedHasVideo as number
  const newTasks = targets.filter((target) => target.disposition === 'new').length
  const alreadyActive = targets.length - newTasks
  if (
    total !== targets.length ||
    declaredNewTasks !== newTasks ||
    declaredAlreadyActive !== alreadyActive ||
    skipped !== skippedMissingImage + skippedHasVideo
  ) {
    invalidQuote('count mismatch')
  }

  return {
    kind: 'quote',
    batchRunId: value.batchRunId,
    quotedAt: value.quotedAt,
    quoteFingerprint: value.quoteFingerprint,
    episodeId: value.episodeId,
    videoModel: value.videoModel,
    currency: value.currency,
    estimatedCostPerTask: value.estimatedCostPerTask,
    estimatedTotalCost: value.estimatedTotalCost,
    targets,
    total,
    newTasks: declaredNewTasks,
    alreadyActive: declaredAlreadyActive,
    skipped,
    skippedMissingImage,
    skippedHasVideo,
  }
}

export function parseStoryboardBatchVideoSubmission(
  value: unknown,
): StoryboardBatchVideoSubmission {
  if (!isRecord(value) || value.kind !== 'submission') {
    invalidSubmission('kind')
  }
  if (
    !isNonEmptyString(value.batchRunId) ||
    !isSignedQuoteToken(value.quoteFingerprint) ||
    !isNonNegativeInteger(value.total) ||
    !isNonNegativeInteger(value.accepted) ||
    !isNonNegativeInteger(value.deduped) ||
    !isNonNegativeInteger(value.rejected) ||
    (value.outcome !== 'accepted' && value.outcome !== 'partial' && value.outcome !== 'failed') ||
    !Array.isArray(value.items)
  ) {
    invalidSubmission('identity, counts, or items')
  }

  const items = value.items.map((item, index) => {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.panelId) ||
      (item.outcome !== 'accepted' && item.outcome !== 'deduped' && item.outcome !== 'rejected')
    ) {
      invalidSubmission(`item ${index}`)
    }
    if (item.outcome === 'rejected') {
      if (
        item.taskId !== null ||
        item.status !== null ||
        !isRecord(item.error) ||
        !isNonEmptyString(item.error.code) ||
        !isNonEmptyString(item.error.message)
      ) {
        invalidSubmission(`rejected item ${index}`)
      }
      return {
        panelId: item.panelId,
        outcome: 'rejected' as const,
        taskId: null,
        status: null,
        error: { code: item.error.code, message: item.error.message },
      }
    }
    if (
      !isNonEmptyString(item.taskId) ||
      !isNonEmptyString(item.status) ||
      item.error !== null
    ) {
      invalidSubmission(`accepted item ${index}`)
    }
    return {
      panelId: item.panelId,
      outcome: item.outcome as 'accepted' | 'deduped',
      taskId: item.taskId,
      status: item.status,
      error: null,
    }
  })

  const accepted = items.filter((item) => item.outcome === 'accepted').length
  const deduped = items.filter((item) => item.outcome === 'deduped').length
  const rejected = items.filter((item) => item.outcome === 'rejected').length
  const expectedOutcome = rejected === 0
    ? 'accepted'
    : accepted + deduped === 0
      ? 'failed'
      : 'partial'
  if (
    value.total !== items.length ||
    value.accepted !== accepted ||
    value.deduped !== deduped ||
    value.rejected !== rejected ||
    value.outcome !== expectedOutcome
  ) {
    invalidSubmission('count or outcome mismatch')
  }

  return {
    kind: 'submission',
    batchRunId: value.batchRunId,
    quoteFingerprint: value.quoteFingerprint,
    total: value.total,
    accepted: value.accepted,
    deduped: value.deduped,
    rejected: value.rejected,
    outcome: value.outcome,
    items,
  }
}
