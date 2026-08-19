import { randomUUID } from 'node:crypto'
import { createFalClient } from '@fal-ai/client'
import type { Job } from 'bullmq'
import {
  claimTaskExternalId,
  persistTaskExternalIdOrThrow,
  replaceTaskExternalIdOrThrow,
} from '@/lib/task/service'
import { TaskTerminatedError } from '@/lib/task/errors'
import type { TaskJobData } from '@/lib/task/types'
import { getTaskExistingExternalId } from '@/lib/workers/utils'

export type VoiceProviderInput = {
  audio_url: string
  prompt: string
  should_use_prompt_for_emotion: boolean
  strength: number
  emotion_prompt?: string
}

type ProviderError = Error & { code?: string }

const CLAIM_PREFIX = 'FAL:VOICE:CLAIM:'
const SUBMIT_CLAIM_FRESH_MS = 60_000
const PROVIDER_SUBMIT_TIMEOUT_MS = 30_000
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000
const PROVIDER_POLL_TIMEOUT_MS = 15 * 60_000
const PROVIDER_POLL_INTERVAL_MS = 1_000

function providerError(message: string, code: 'INVALID_PARAMS' | 'EXTERNAL_ERROR', cause?: unknown): ProviderError {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code })
}

function falVoiceExternalId(endpoint: string, requestId: string): string {
  return `FAL:VOICE:${endpoint}:${requestId}`
}

function newSubmitClaimId(): string {
  return `${CLAIM_PREFIX}${Date.now()}:${randomUUID()}`
}

function isFreshSubmitClaim(value: string, now = Date.now()): boolean {
  if (!value.startsWith(CLAIM_PREFIX)) return false
  const timestamp = Number.parseInt(value.slice(CLAIM_PREFIX.length).split(':', 1)[0] || '', 10)
  return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= SUBMIT_CLAIM_FRESH_MS
}

function throwForUnresolvedSubmitClaim(taskId: string, claimId: string): never {
  if (isFreshSubmitClaim(claimId)) {
    // A second processor for the same BullMQ job must not turn the shared Task
    // failed while the submit owner can still publish its provider id/result.
    throw new TaskTerminatedError(taskId, 'Voice provider submit is owned by another processor')
  }
  // An old/unparseable claim cannot safely be stolen: the original POST may
  // have been accepted without its acknowledgement reaching us. Keep the
  // active Task/dedupe/billing freeze quarantined; a plain INVALID_PARAMS
  // would let the generic terminal lifecycle fail and refund a possibly-paid
  // provider handoff.
  throw new TaskTerminatedError(taskId, 'VOICE_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED')
}

function parseFalVoiceExternalId(value: string): { endpoint: string; requestId: string } {
  const prefix = 'FAL:VOICE:'
  if (!value.startsWith(prefix) || value.startsWith(CLAIM_PREFIX)) {
    throw providerError('VOICE_PROVIDER_EXTERNAL_ID_INVALID', 'INVALID_PARAMS')
  }
  const remainder = value.slice(prefix.length)
  const separator = remainder.lastIndexOf(':')
  const endpoint = separator > 0 ? remainder.slice(0, separator) : ''
  const requestId = separator > 0 ? remainder.slice(separator + 1) : ''
  if (!endpoint || !requestId) {
    throw providerError('VOICE_PROVIDER_EXTERNAL_ID_INVALID', 'INVALID_PARAMS')
  }
  return { endpoint, requestId }
}

function hasAnotherQueueAttempt(job: Job<TaskJobData>): boolean {
  const configuredAttempts = job.opts?.attempts
  if (
    typeof configuredAttempts !== 'number'
    || !Number.isFinite(configuredAttempts)
    || configuredAttempts < 1
  ) return false
  const attemptsMade = Number.isFinite(job.attemptsMade)
    ? Math.max(0, Math.floor(job.attemptsMade))
    : 0
  return attemptsMade + 1 < Math.floor(configuredAttempts)
}

function quarantinePaidHandoff(
  job: Job<TaskJobData>,
  message: string,
  cause?: unknown,
): TaskTerminatedError {
  return Object.assign(new TaskTerminatedError(job.data.taskId, message), {
    ...(cause === undefined ? {} : { cause }),
  })
}

async function resolveFalApiKey(params: {
  job: Job<TaskJobData>
  apiKey?: string
  resolveApiKey?: () => Promise<string>
  paidHandoff: boolean
}): Promise<string> {
  try {
    const directApiKey = params.apiKey?.trim() || ''
    const resolvedApiKey = directApiKey || (await params.resolveApiKey?.())?.trim() || ''
    if (!resolvedApiKey) throw new Error('FAL_API_KEY_MISSING')
    return resolvedApiKey
  } catch (error) {
    if (params.paidHandoff && !hasAnotherQueueAttempt(params.job)) {
      throw quarantinePaidHandoff(
        params.job,
        'VOICE_PROVIDER_CREDENTIAL_QUARANTINED',
        error,
      )
    }
    throw providerError('VOICE_PROVIDER_CREDENTIAL_UNAVAILABLE', 'EXTERNAL_ERROR', error)
  }
}

function withTimeoutSignal<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string,
  options?: {
    timeoutCode?: 'INVALID_PARAMS' | 'EXTERNAL_ERROR'
    checkCancelled?: (stage: string) => Promise<void>
    cancelStage?: string
  },
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let cancelError: unknown = null
  let cancellationCheckRunning = false
  const cancellationTimer = options?.checkCancelled
    ? setInterval(() => {
      if (cancellationCheckRunning || controller.signal.aborted) return
      cancellationCheckRunning = true
      void options.checkCancelled!(options.cancelStage || 'voice_line_provider_request')
        .catch((error) => {
          cancelError = error
          controller.abort()
        })
        .finally(() => {
          cancellationCheckRunning = false
        })
    }, 1_000)
    : null
  return operation(controller.signal)
    .finally(() => {
      clearTimeout(timeout)
      if (cancellationTimer) clearInterval(cancellationTimer)
    })
    .catch((error) => {
      if (cancelError) throw cancelError
      if (controller.signal.aborted) {
        throw providerError(timeoutMessage, options?.timeoutCode || 'EXTERNAL_ERROR', error)
      }
      throw error
    })
}

async function submitFalVoiceOnce(params: {
  endpoint: string
  input: VoiceProviderInput
  apiKey: string
}): Promise<string> {
  // One POST, including body parsing, under one deadline. Any non-2xx or
  // transport ambiguity is deliberately non-retryable: without a provider
  // idempotency token we cannot prove the request was not accepted.
  return await withTimeoutSignal(PROVIDER_SUBMIT_TIMEOUT_MS, async (signal) => {
    let response: Response
    try {
      response = await fetch(`https://queue.fal.run/${params.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${params.apiKey}`,
        },
        body: JSON.stringify(params.input),
        signal,
        cache: 'no-store',
      })
    } catch (error) {
      throw providerError('VOICE_PROVIDER_SUBMIT_OUTCOME_UNKNOWN', 'INVALID_PARAMS', error)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw providerError(
        `VOICE_PROVIDER_SUBMIT_OUTCOME_UNKNOWN_${response.status}:${detail.slice(0, 240)}`,
        'INVALID_PARAMS',
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      const headerRequestId = response.headers.get('x-fal-request-id')?.trim()
      if (headerRequestId) return headerRequestId
      throw providerError('VOICE_PROVIDER_SUBMIT_OUTCOME_UNKNOWN', 'INVALID_PARAMS', error)
    }
    const requestId = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).request_id
      : null
    if (typeof requestId !== 'string' || !requestId.trim()) {
      throw providerError('VOICE_PROVIDER_SUBMIT_OUTCOME_UNKNOWN', 'INVALID_PARAMS')
    }
    return requestId.trim()
  }, 'VOICE_PROVIDER_SUBMIT_OUTCOME_UNKNOWN', { timeoutCode: 'INVALID_PARAMS' })
}

function resultAudioUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : record
  const audio = data.audio && typeof data.audio === 'object' && !Array.isArray(data.audio)
    ? data.audio as Record<string, unknown>
    : null
  return typeof audio?.url === 'string' && audio.url.trim() ? audio.url.trim() : null
}

function isTaskCancellation(error: unknown): boolean {
  if (error instanceof TaskTerminatedError) return true
  if (!(error instanceof Error)) return false
  return error.message.includes('TASK_CANCELLED')
    || (typeof (error as ProviderError).code === 'string'
      && (error as ProviderError).code === 'TASK_CANCELLED')
}

function throwRetryablePaidHandoffErrorOrQuarantine(
  job: Job<TaskJobData>,
  quarantineMessage: string,
  error: unknown,
): never {
  if (!hasAnotherQueueAttempt(job)) {
    throw quarantinePaidHandoff(job, quarantineMessage, error)
  }
  throw error
}

export async function resolveDurableFalVoiceAudioUrl(params: {
  job: Job<TaskJobData>
  endpoint: string
  input?: VoiceProviderInput
  resolveInput?: () => Promise<VoiceProviderInput>
  apiKey?: string
  resolveApiKey?: () => Promise<string>
  checkCancelled?: (stage: string) => Promise<void>
}): Promise<string> {
  const { job, endpoint } = params
  const jobExternalId = job.data.providerExternalId?.trim() || null
  let databaseExternalId = await getTaskExistingExternalId(job.data.taskId)
  const jobClaimId = job.data.payload
    && typeof job.data.payload === 'object'
    && !Array.isArray(job.data.payload)
    && typeof (job.data.payload as Record<string, unknown>).voiceProviderSubmitClaimId === 'string'
    ? String((job.data.payload as Record<string, unknown>).voiceProviderSubmitClaimId)
    : null
  if (jobExternalId && databaseExternalId && jobExternalId !== databaseExternalId) {
    if (databaseExternalId === jobClaimId && databaseExternalId.startsWith(CLAIM_PREFIX)) {
      await replaceTaskExternalIdOrThrow(job.data.taskId, databaseExternalId, jobExternalId)
      databaseExternalId = jobExternalId
    } else {
      throw providerError('VOICE_PROVIDER_EXTERNAL_ID_CONFLICT', 'INVALID_PARAMS')
    }
  }

  let externalId = databaseExternalId || jobExternalId
  if (externalId?.startsWith(CLAIM_PREFIX)) {
    throwForUnresolvedSubmitClaim(job.data.taskId, externalId)
  }
  let parsed: { endpoint: string; requestId: string } | null = null
  if (externalId) {
    try {
      parsed = parseFalVoiceExternalId(externalId)
    } catch (error) {
      throw quarantinePaidHandoff(job, 'VOICE_PROVIDER_EXTERNAL_ID_QUARANTINED', error)
    }
    if (parsed.endpoint !== endpoint) {
      throw quarantinePaidHandoff(job, 'VOICE_PROVIDER_EXTERNAL_ID_CONTEXT_MISMATCH')
    }
    if (!databaseExternalId) {
      // Validate the exact pinned endpoint before copying the BullMQ
      // checkpoint into the authoritative Task row.
      await persistTaskExternalIdOrThrow(job.data.taskId, externalId)
    }
  }

  let apiKey: string | null = null
  if (!externalId) {
    const providerInput = params.input || await params.resolveInput?.()
    if (!providerInput) {
      throw providerError('VOICE_PROVIDER_EXTERNAL_ID_REQUIRED', 'INVALID_PARAMS')
    }
    // Resolve credentials before claiming submit ownership. A missing key is
    // retryable here and cannot strand a CLAIM for a POST that never happened.
    apiKey = await resolveFalApiKey({
      job,
      apiKey: params.apiKey,
      resolveApiKey: params.resolveApiKey,
      paidHandoff: false,
    })
    await params.checkCancelled?.('voice_line_pre_provider_submit')
    const claimId = newSubmitClaimId()
    const claim = await claimTaskExternalId(job.data.taskId, claimId)
    if (!claim.claimed) {
      const winner = claim.externalId
      if (!winner) {
        throw providerError('VOICE_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED', 'INVALID_PARAMS')
      }
      if (winner.startsWith(CLAIM_PREFIX)) throwForUnresolvedSubmitClaim(job.data.taskId, winner)
      externalId = winner
    } else {
      const requestId = await submitFalVoiceOnce({
        endpoint,
        input: providerInput,
        apiKey,
      })
      externalId = falVoiceExternalId(endpoint, requestId)
      try {
        const nextPayload = {
          ...(job.data.payload && typeof job.data.payload === 'object' && !Array.isArray(job.data.payload)
            ? job.data.payload as Record<string, unknown>
            : {}),
          voiceProviderSubmitClaimId: claimId,
        }
        await job.updateData({ ...job.data, payload: nextPayload, providerExternalId: externalId })
        job.data.payload = nextPayload
        job.data.providerExternalId = externalId
      } catch {
        // The database replacement below is authoritative. BullMQ remains a
        // second checkpoint for the response-loss path when DB is unavailable.
      }
      await replaceTaskExternalIdOrThrow(job.data.taskId, claimId, externalId)
    }
  }

  if (!parsed) {
    try {
      parsed = parseFalVoiceExternalId(externalId)
    } catch (error) {
      throw quarantinePaidHandoff(job, 'VOICE_PROVIDER_EXTERNAL_ID_QUARANTINED', error)
    }
    if (parsed.endpoint !== endpoint) {
      throw quarantinePaidHandoff(job, 'VOICE_PROVIDER_EXTERNAL_ID_CONTEXT_MISMATCH')
    }
  }

  apiKey ||= await resolveFalApiKey({
    job,
    apiKey: params.apiKey,
    resolveApiKey: params.resolveApiKey,
    paidHandoff: true,
  })
  const client = createFalClient({ credentials: apiKey })
  const deadline = Date.now() + PROVIDER_POLL_TIMEOUT_MS
  while (Date.now() <= deadline) {
    await params.checkCancelled?.('voice_line_provider_poll')
    let status: { status?: string }
    try {
      status = await withTimeoutSignal(PROVIDER_REQUEST_TIMEOUT_MS, async (abortSignal) => (
        await client.queue.status(endpoint, {
          requestId: parsed.requestId,
          logs: false,
          abortSignal,
        }) as { status?: string }
      ), 'VOICE_PROVIDER_STATUS_TIMEOUT', {
        checkCancelled: params.checkCancelled,
        cancelStage: 'voice_line_provider_status',
      })
    } catch (error) {
      if (isTaskCancellation(error)) throw error
      const retryableError = (error as ProviderError)?.code === 'EXTERNAL_ERROR'
        ? error
        : providerError('VOICE_PROVIDER_STATUS_FAILED', 'EXTERNAL_ERROR', error)
      throwRetryablePaidHandoffErrorOrQuarantine(
        job,
        'VOICE_PROVIDER_STATUS_QUARANTINED',
        retryableError,
      )
    }

    if (status.status === 'COMPLETED') {
      await params.checkCancelled?.('voice_line_pre_provider_result')
      let result: unknown
      try {
        result = await withTimeoutSignal(PROVIDER_REQUEST_TIMEOUT_MS, async (abortSignal) => (
          await client.queue.result(endpoint, {
            requestId: parsed.requestId,
            abortSignal,
          })
        ), 'VOICE_PROVIDER_RESULT_TIMEOUT', {
          checkCancelled: params.checkCancelled,
          cancelStage: 'voice_line_provider_result',
        })
      } catch (error) {
        if (isTaskCancellation(error)) throw error
        const retryableError = (error as ProviderError)?.code === 'EXTERNAL_ERROR'
          ? error
          : providerError('VOICE_PROVIDER_RESULT_FAILED', 'EXTERNAL_ERROR', error)
        throwRetryablePaidHandoffErrorOrQuarantine(
          job,
          'VOICE_PROVIDER_RESULT_QUARANTINED',
          retryableError,
        )
      }
      const audioUrl = resultAudioUrl(result)
      if (!audioUrl) {
        throw providerError('VOICE_PROVIDER_RESULT_AUDIO_MISSING', 'INVALID_PARAMS')
      }
      return audioUrl
    }
    if (status.status !== 'IN_QUEUE' && status.status !== 'IN_PROGRESS') {
      // The installed FAL queue contract only documents COMPLETED, IN_QUEUE,
      // and IN_PROGRESS. An empty or future status is not proof that the paid
      // request was rejected, so keep the exact handoff and retry/quarantine
      // instead of entering the refund/new-submit path.
      throwRetryablePaidHandoffErrorOrQuarantine(
        job,
        'VOICE_PROVIDER_STATUS_QUARANTINED',
        providerError('VOICE_PROVIDER_STATUS_UNKNOWN', 'EXTERNAL_ERROR'),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, PROVIDER_POLL_INTERVAL_MS))
  }
  const pollTimeoutError = providerError('VOICE_PROVIDER_POLL_TIMEOUT', 'EXTERNAL_ERROR')
  throwRetryablePaidHandoffErrorOrQuarantine(
    job,
    'VOICE_PROVIDER_STATUS_QUARANTINED',
    pollTimeoutError,
  )
}
