import { InsufficientBalanceError } from '@/lib/billing/errors'
import { getPrismaErrorCode, isLikelyPrismaDisconnectError, isPrismaRetryableCode } from '@/lib/prisma-error'
import { DEFAULT_ERROR_CODE, getErrorSpec, isKnownErrorCode, resolveUnifiedErrorCode, type UnifiedErrorCode } from './codes'
import type { ErrorContext, NormalizedError, NormalizedErrorDetails } from './types'

type NormalizeOptions = {
  context?: ErrorContext
  fallbackCode?: UnifiedErrorCode
  details?: Record<string, unknown> | null
}

type ErrorLike = {
  code?: unknown
  status?: unknown
  message?: unknown
  details?: unknown
  provider?: unknown
}

function toMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value instanceof Error && value.message.trim()) return value.message.trim()
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function toLowerMessage(value: unknown): string {
  return toMessage(value).toLowerCase()
}

function containsAny(haystack: string, needles: string[]) {
  for (const needle of needles) {
    if (haystack.includes(needle)) return true
  }
  return false
}

function buildNormalizedError(
  code: UnifiedErrorCode,
  message?: string,
  details: NormalizedErrorDetails = null,
  provider?: string | null,
): NormalizedError {
  const spec = getErrorSpec(code)
  return {
    code,
    message: message?.trim() || spec.defaultMessage,
    httpStatus: spec.httpStatus,
    retryable: spec.retryable,
    category: spec.category,
    userMessageKey: spec.userMessageKey,
    details,
    provider: provider || null,
  }
}

function inferCodeFromMessage(message: string): UnifiedErrorCode | null {
  const upper = message.toUpperCase()
  const explicitMatch = upper.match(/\b([A-Z_]{3,})\b/)
  if (explicitMatch && isKnownErrorCode(explicitMatch[1])) {
    return explicitMatch[1]
  }

  // 2026-05-21 — episode missing clips (bare Error thrown by
  // script-to-storyboard worker when STEP 01 wasn't run yet). Matched
  // BEFORE the generic 'not found' rule below — otherwise it'd
  // resolve to NOT_FOUND which is also misleading.
  if (containsAny(message, ['no clips found', 'no clips, please split'])) return 'EPISODE_NO_CLIPS'
  // 2026-05-21 — another task (clips_build / script_to_storyboard_run /
  // etc.) still processing for the same episode. The route's task-conflict
  // guard throws CONFLICT with the literal phrases below. Matched BEFORE
  // the generic 'conflict' / 'already exists' rule so user sees the
  // specific "wait a few seconds" message rather than "refresh and retry".
  if (containsAny(message, [
    'still processing for this episode',
    'still processing for this',
    'another task',
    'wait for it to finish and try',
  ])) return 'TASK_STILL_PROCESSING'
  if (containsAny(message, ['task cancelled', 'canceled by user', 'cancelled by user', '任务已取消'])) return 'CONFLICT'
  if (containsAny(message, ['unauthorized', 'not authenticated', 'need login', '401'])) return 'UNAUTHORIZED'
  if (containsAny(message, ['forbidden', 'permission denied', '403'])) return 'FORBIDDEN'
  if (containsAny(message, ['not found', '不存在', 'missing record'])) return 'NOT_FOUND'
  if (containsAny(message, ['invalid', 'missing', 'required', 'bad request', 'fieldinvalid'])) return 'INVALID_PARAMS'
  if (containsAny(message, ['quota', 'rate limit', 'resource_exhausted', 'throttle', '429', 'requestlimitexceeded', 'maximum concurrency', 'reached the maximum'])) return 'RATE_LIMIT'
  if (containsAny(message, ['insufficient balance', 'creditinsufficient', 'balance is not enough', '402', 'insufficient credits', '余额不足', '余额不够', '请充值'])) return 'INSUFFICIENT_BALANCE'
  if (containsAny(message, ['sensitive', 'unsafe', 'safety', 'blocked', 'prohibited', 'policy_violation', 'moderation', 'harm', 'celebrity', 'likenesses', '敏感', '违规', '不当']) && !containsAny(message, ['case-sensitive', 'case sensitive'])) return 'SENSITIVE_CONTENT'
  if (containsAny(message, ['timeout', 'timed out', 'deadline exceeded'])) return 'GENERATION_TIMEOUT'
  if (containsAny(message, ['503', 'unavailable', 'overloaded', 'upstream error', 'exceeds limit', 'size limit', 'no result url'])) return 'EXTERNAL_ERROR'
  if (containsAny(message, ['network', 'fetch failed', 'econnreset', 'enotfound', 'econnrefused', 'eai_again', 'terminated', 'aborted', 'socket hang up'])) return 'NETWORK_ERROR'
  if (containsAny(message, ['conflict', 'already exists', 'duplicate'])) return 'CONFLICT'
  return null
}

function inferCodeFromPrismaCode(prismaCode: string): UnifiedErrorCode {
  if (prismaCode === 'P2002') return 'CONFLICT'
  if (prismaCode === 'P2001' || prismaCode === 'P2025') return 'NOT_FOUND'
  if (isPrismaRetryableCode(prismaCode)) return 'EXTERNAL_ERROR'
  return 'INTERNAL_ERROR'
}

export function normalizeAnyError(input: unknown, options: NormalizeOptions = {}): NormalizedError {
  const fallbackCode = options.fallbackCode || DEFAULT_ERROR_CODE
  const errorLike = (input || {}) as ErrorLike
  const message = toMessage(errorLike.message ?? input)
  const lowerMessage = toLowerMessage(message)
  const provider = typeof errorLike.provider === 'string' ? errorLike.provider : null

  if (input instanceof TypeError) {
    if (lowerMessage === 'terminated' || containsAny(lowerMessage, ['aborted', 'socket hang up'])) {
      return buildNormalizedError(
        'NETWORK_ERROR',
        message || 'Network request terminated',
        options.details,
        provider,
      )
    }
  }

  const prismaCode = getPrismaErrorCode(input)
  if (prismaCode) {
    return buildNormalizedError(
      inferCodeFromPrismaCode(prismaCode),
      message || `Database request failed (${prismaCode})`,
      {
        prismaCode,
        ...(options.details || {}),
      },
      provider,
    )
  }

  if (isLikelyPrismaDisconnectError(input)) {
    return buildNormalizedError(
      'EXTERNAL_ERROR',
      message || 'Database connection unavailable',
      options.details,
      provider,
    )
  }

  if (input instanceof InsufficientBalanceError) {
    return buildNormalizedError('INSUFFICIENT_BALANCE', message || input.message, {
      required: input.required,
      available: input.available,
      ...(options.details || {}),
    })
  }

  const resolvedCode = resolveUnifiedErrorCode(errorLike.code)
  // 2026-05-21 — Some "resolved" codes are catch-all buckets that
  // benefit from message inference refining them into more specific
  // codes:
  //   - INTERNAL_ERROR: worker fallback when task layer couldn't extract
  //     a specific code. "No clips found" → EPISODE_NO_CLIPS.
  //   - CONFLICT: route's task-conflict guard throws CONFLICT but the
  //     message distinguishes "still processing" (just wait) from
  //     "duplicate / already exists" (refresh and retry). Inference
  //     picks TASK_STILL_PROCESSING for the wait case.
  // Other resolved codes (SENSITIVE_CONTENT, NOT_FOUND etc.) are
  // trustworthy and used directly.
  const inferenceCandidateCodes = new Set(['INTERNAL_ERROR', 'CONFLICT'])
  if (resolvedCode && !inferenceCandidateCodes.has(resolvedCode)) {
    return buildNormalizedError(resolvedCode, message, {
      ...(typeof errorLike.details === 'object' && errorLike.details ? (errorLike.details as Record<string, unknown>) : {}),
      ...(options.details || {}),
    }, provider)
  }

  if (typeof errorLike.status === 'number') {
    if (errorLike.status === 401) return buildNormalizedError('UNAUTHORIZED', message, options.details, provider)
    if (errorLike.status === 403) return buildNormalizedError('FORBIDDEN', message, options.details, provider)
    if (errorLike.status === 404) return buildNormalizedError('NOT_FOUND', message, options.details, provider)
    if (errorLike.status === 409) return buildNormalizedError('CONFLICT', message, options.details, provider)
    if (errorLike.status === 422) return buildNormalizedError('SENSITIVE_CONTENT', message, options.details, provider)
    if (errorLike.status === 429) return buildNormalizedError('RATE_LIMIT', message, options.details, provider)
    if (errorLike.status === 502 || errorLike.status === 503) return buildNormalizedError('EXTERNAL_ERROR', message, options.details, provider)
    if (errorLike.status === 504) return buildNormalizedError('GENERATION_TIMEOUT', message, options.details, provider)
  }

  const inferredCode = inferCodeFromMessage(lowerMessage)
  if (inferredCode) {
    return buildNormalizedError(inferredCode, message, options.details, provider)
  }

  if (options.context === 'worker' && containsAny(lowerMessage, ['provider', 'generation failed'])) {
    return buildNormalizedError('GENERATION_FAILED', message, options.details, provider)
  }

  return buildNormalizedError(fallbackCode, message || getErrorSpec(fallbackCode).defaultMessage, options.details, provider)
}

export function normalizeTaskError(
  code: string | null | undefined,
  message: string | null | undefined,
  details: Record<string, unknown> | null = null,
): NormalizedError | null {
  if (!code && !message) return null

  if (code === 'TASK_CANCELLED') {
    return buildNormalizedError(
      'CONFLICT',
      message || 'Task cancelled by user',
      {
        ...(details || {}),
        cancelled: true,
        originalCode: code,
      },
    )
  }

  const resolvedTaskCode = resolveUnifiedErrorCode(code)
  if (resolvedTaskCode) {
    return buildNormalizedError(resolvedTaskCode, message || undefined, details)
  }

  const inferred = normalizeAnyError(
    {
      code,
      message,
      details,
    },
    {
      fallbackCode: DEFAULT_ERROR_CODE,
    },
  )

  if (code && !resolveUnifiedErrorCode(code)) {
    return {
      ...inferred,
      details: {
        ...(inferred.details || {}),
        originalCode: code,
      },
    }
  }

  return inferred
}
