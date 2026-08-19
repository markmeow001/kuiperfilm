import { randomUUID } from 'node:crypto'
import type { Job } from 'bullmq'
import {
  claimTaskExternalId,
  persistTaskExternalIdOrThrow,
  replaceTaskExternalIdOrThrow,
} from '@/lib/task/service'
import { TaskTerminatedError } from '@/lib/task/errors'
import { releaseRejectedProviderSubmitClaimOrThrow } from '@/lib/task/provider-submit-claim'
import type { TaskJobData } from '@/lib/task/types'
import { getTaskExistingExternalId } from '@/lib/workers/utils'
export { ATLASCLOUD_SEED_AUDIO_MODEL_ID } from '@/lib/voice/atlascloud-seed-audio-contract'
import { ATLASCLOUD_SEED_AUDIO_MODEL_ID } from '@/lib/voice/atlascloud-seed-audio-contract'

export type AtlasCloudVoiceReference =
  | { audio_data: string; audio_url?: never }
  | { audio_url: string; audio_data?: never }

export type AtlasCloudVoiceInput = {
  text: string
  references: AtlasCloudVoiceReference[]
  format: 'wav'
  sample_rate: 24000
  pitch_rate: number
  speech_rate: number
  loudness_rate: number
}

type AtlasCloudVoiceErrorCode = 'INVALID_PARAMS' | 'EXTERNAL_ERROR' | 'GENERATION_TIMEOUT'
type AtlasCloudVoiceError = Error & {
  code?: AtlasCloudVoiceErrorCode
  provider?: 'atlascloud'
  submitDefinitelyRejected?: boolean
}

type AtlasCloudPrediction = {
  status: string
  outputs: string[]
}

const ATLASCLOUD_BASE_URL = 'https://api.atlascloud.ai/api/v1'
const EXTERNAL_ID_PREFIX = 'ATLASCLOUD:AUDIO:'
const CLAIM_PREFIX = 'ATLASCLOUD:AUDIO:CLAIM:'
const SUBMIT_CLAIM_FRESH_MS = 60_000
const PROVIDER_SUBMIT_TIMEOUT_MS = 30_000
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000
const PROVIDER_POLL_TIMEOUT_MS = 15 * 60_000
const PROVIDER_POLL_INTERVAL_MS = 1_000

function providerError(
  message: string,
  code: AtlasCloudVoiceErrorCode,
  cause?: unknown,
): AtlasCloudVoiceError {
  return Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    { code, provider: 'atlascloud' as const },
  )
}

function submitRejectedError(status: number): AtlasCloudVoiceError {
  return Object.assign(
    providerError('ATLAS_AUDIO_PROVIDER_SUBMIT_REJECTED', 'INVALID_PARAMS'),
    { submitDefinitelyRejected: true, status },
  )
}

function isDefinitiveSubmitRejection(error: unknown): error is AtlasCloudVoiceError {
  return Boolean(
    error
    && typeof error === 'object'
    && 'submitDefinitelyRejected' in error
    && error.submitDefinitelyRejected === true,
  )
}

function quarantinePaidHandoff(
  job: Job<TaskJobData>,
  message: string,
  cause?: unknown,
): TaskTerminatedError & { code: 'INVALID_PARAMS'; provider: 'atlascloud' } {
  return Object.assign(new TaskTerminatedError(job.data.taskId, message), {
    code: 'INVALID_PARAMS' as const,
    provider: 'atlascloud' as const,
    ...(cause === undefined ? {} : { cause }),
  })
}

function newSubmitClaimId(): string {
  return `${CLAIM_PREFIX}${Date.now()}:${randomUUID()}`
}

function isFreshSubmitClaim(value: string, now = Date.now()): boolean {
  if (!value.startsWith(CLAIM_PREFIX)) return false
  const timestamp = Number.parseInt(value.slice(CLAIM_PREFIX.length).split(':', 1)[0] || '', 10)
  return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= SUBMIT_CLAIM_FRESH_MS
}

function throwForUnresolvedSubmitClaim(job: Job<TaskJobData>, claimId: string): never {
  if (isFreshSubmitClaim(claimId)) {
    throw quarantinePaidHandoff(
      job,
      'AtlasCloud audio provider submit is owned by another processor',
    )
  }
  throw quarantinePaidHandoff(
    job,
    'ATLAS_AUDIO_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED',
  )
}

function atlasCloudAudioExternalId(modelId: string, predictionId: string): string {
  return `${EXTERNAL_ID_PREFIX}${modelId}:${predictionId}`
}

function parseAtlasCloudAudioExternalId(value: string): {
  modelId: string
  predictionId: string
} {
  if (!value.startsWith(EXTERNAL_ID_PREFIX) || value.startsWith(CLAIM_PREFIX)) {
    throw providerError('ATLAS_AUDIO_PROVIDER_EXTERNAL_ID_INVALID', 'INVALID_PARAMS')
  }
  const remainder = value.slice(EXTERNAL_ID_PREFIX.length)
  const separator = remainder.lastIndexOf(':')
  const modelId = separator > 0 ? remainder.slice(0, separator) : ''
  const predictionId = separator > 0 ? remainder.slice(separator + 1) : ''
  if (!modelId || !predictionId) {
    throw providerError('ATLAS_AUDIO_PROVIDER_EXTERNAL_ID_INVALID', 'INVALID_PARAMS')
  }
  return { modelId, predictionId }
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

function isTaskCancellation(error: unknown): boolean {
  if (error instanceof TaskTerminatedError) return true
  if (!(error instanceof Error)) return false
  const code = 'code' in error ? String(error.code || '') : ''
  return code === 'TASK_CANCELLED' || error.message.includes('TASK_CANCELLED')
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

async function resolveAtlasCloudApiKey(params: {
  job: Job<TaskJobData>
  apiKey?: string
  resolveApiKey?: () => Promise<string>
  paidHandoff: boolean
}): Promise<string> {
  try {
    const directApiKey = params.apiKey?.trim() || ''
    const resolvedApiKey = directApiKey || (await params.resolveApiKey?.())?.trim() || ''
    if (!resolvedApiKey) throw new Error('ATLASCLOUD_API_KEY_MISSING')
    return resolvedApiKey
  } catch (error) {
    if (params.paidHandoff && !hasAnotherQueueAttempt(params.job)) {
      throw quarantinePaidHandoff(
        params.job,
        'ATLAS_AUDIO_PROVIDER_CREDENTIAL_QUARANTINED',
        error,
      )
    }
    throw providerError('ATLAS_AUDIO_PROVIDER_CREDENTIAL_UNAVAILABLE', 'EXTERNAL_ERROR', error)
  }
}

function withTimeoutSignal<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string,
  options?: {
    timeoutCode?: AtlasCloudVoiceErrorCode
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
      void options.checkCancelled!(options.cancelStage || 'voice_line_atlascloud_request')
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
        throw providerError(
          timeoutMessage,
          options?.timeoutCode || 'GENERATION_TIMEOUT',
          error,
        )
      }
      throw error
    })
}

function validateModelId(modelId: string): string {
  const value = modelId.trim()
  if (value !== ATLASCLOUD_SEED_AUDIO_MODEL_ID) {
    throw providerError('ATLAS_AUDIO_PROVIDER_MODEL_UNSUPPORTED', 'INVALID_PARAMS')
  }
  return value
}

function normalizeVoiceInput(input: AtlasCloudVoiceInput): AtlasCloudVoiceInput {
  const text = typeof input?.text === 'string' ? input.text.trim() : ''
  const references = Array.isArray(input?.references)
    ? input.references.map((reference): AtlasCloudVoiceReference | null => {
      const audioData = typeof reference?.audio_data === 'string'
        ? reference.audio_data.trim()
        : ''
      const audioUrl = typeof reference?.audio_url === 'string'
        ? reference.audio_url.trim()
        : ''
      if (Boolean(audioData) === Boolean(audioUrl)) return null
      return audioData ? { audio_data: audioData } : { audio_url: audioUrl }
    })
    : []
  const rates = [input?.pitch_rate, input?.speech_rate, input?.loudness_rate]
  const pitchRate = input?.pitch_rate
  const speechRate = input?.speech_rate
  const loudnessRate = input?.loudness_rate
  if (
    !text
    || references.length < 1
    || references.some((reference) => reference === null)
    || input?.format !== 'wav'
    || input?.sample_rate !== 24_000
    || rates.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    || !Number.isInteger(pitchRate)
    || pitchRate < -12
    || pitchRate > 12
    || !Number.isInteger(speechRate)
    || speechRate < -50
    || speechRate > 100
    || !Number.isInteger(loudnessRate)
    || loudnessRate < -50
    || loudnessRate > 100
  ) {
    throw providerError('ATLAS_AUDIO_PROVIDER_INPUT_INVALID', 'INVALID_PARAMS')
  }
  return {
    text,
    references: references.filter((reference): reference is AtlasCloudVoiceReference => reference !== null),
    format: 'wav',
    sample_rate: 24_000,
    pitch_rate: input.pitch_rate,
    speech_rate: input.speech_rate,
    loudness_rate: input.loudness_rate,
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function responseData(value: unknown): Record<string, unknown> | null {
  const body = recordValue(value)
  if (!body) return null
  return recordValue(body.data) || body
}

function responseCodeIsSuccessful(value: unknown): boolean {
  const body = recordValue(value)
  return body?.code === undefined || body.code === 200
}

function responseRejectionStatus(value: unknown): number | null {
  const body = recordValue(value)
  const raw = body?.code
  const code = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && /^\d+$/.test(raw.trim())
      ? Number(raw)
      : Number.NaN
  return Number.isInteger(code) && [400, 401, 403, 404, 409, 422, 429].includes(code)
    ? code
    : null
}

async function submitAtlasCloudAudioOnce(params: {
  modelId: string
  input: AtlasCloudVoiceInput
  apiKey: string
  checkCancelled?: (stage: string) => Promise<void>
}): Promise<string> {
  return await withTimeoutSignal(PROVIDER_SUBMIT_TIMEOUT_MS, async (signal) => {
    const response = await fetch(`${ATLASCLOUD_BASE_URL}/model/generateAudio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({ model: params.modelId, ...params.input }),
      signal,
      cache: 'no-store',
    })
    if (!response.ok) {
      if ([400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
        throw submitRejectedError(response.status)
      }
      throw providerError('ATLAS_AUDIO_PROVIDER_SUBMIT_OUTCOME_UNKNOWN', 'INVALID_PARAMS')
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw providerError('ATLAS_AUDIO_PROVIDER_SUBMIT_OUTCOME_UNKNOWN', 'INVALID_PARAMS', error)
    }
    if (!responseCodeIsSuccessful(body)) {
      const rejectionStatus = responseRejectionStatus(body)
      if (rejectionStatus !== null) throw submitRejectedError(rejectionStatus)
      throw providerError('ATLAS_AUDIO_PROVIDER_SUBMIT_OUTCOME_UNKNOWN', 'INVALID_PARAMS')
    }
    const data = responseData(body)
    const predictionId = typeof data?.id === 'string' ? data.id.trim() : ''
    if (!predictionId) {
      throw providerError('ATLAS_AUDIO_PROVIDER_SUBMIT_OUTCOME_UNKNOWN', 'INVALID_PARAMS')
    }
    return predictionId
  }, 'ATLAS_AUDIO_PROVIDER_SUBMIT_OUTCOME_UNKNOWN', {
    timeoutCode: 'INVALID_PARAMS',
    checkCancelled: params.checkCancelled,
    cancelStage: 'voice_line_atlascloud_submit',
  })
}

async function queryAtlasCloudAudioPrediction(params: {
  predictionId: string
  apiKey: string
  checkCancelled?: (stage: string) => Promise<void>
}): Promise<AtlasCloudPrediction> {
  return await withTimeoutSignal(PROVIDER_REQUEST_TIMEOUT_MS, async (signal) => {
    const response = await fetch(
      `${ATLASCLOUD_BASE_URL}/model/prediction/${encodeURIComponent(params.predictionId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${params.apiKey}` },
        signal,
        cache: 'no-store',
      },
    )
    if (!response.ok) {
      throw providerError('ATLAS_AUDIO_PROVIDER_STATUS_FAILED', 'EXTERNAL_ERROR')
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw providerError('ATLAS_AUDIO_PROVIDER_STATUS_FAILED', 'EXTERNAL_ERROR', error)
    }
    if (!responseCodeIsSuccessful(body)) {
      throw providerError('ATLAS_AUDIO_PROVIDER_STATUS_FAILED', 'EXTERNAL_ERROR')
    }
    const data = responseData(body)
    const status = typeof data?.status === 'string' ? data.status.trim().toLowerCase() : ''
    const outputs = Array.isArray(data?.outputs)
      ? data.outputs
        .filter((output): output is string => typeof output === 'string' && Boolean(output.trim()))
        .map((output) => output.trim())
      : []
    if (!status) {
      throw providerError('ATLAS_AUDIO_PROVIDER_STATUS_INVALID', 'EXTERNAL_ERROR')
    }
    return { status, outputs }
  }, 'ATLAS_AUDIO_PROVIDER_STATUS_TIMEOUT', {
    timeoutCode: 'GENERATION_TIMEOUT',
    checkCancelled: params.checkCancelled,
    cancelStage: 'voice_line_atlascloud_status',
  })
}

export async function resolveDurableAtlasCloudVoiceAudioUrl(params: {
  job: Job<TaskJobData>
  modelId: string
  input?: AtlasCloudVoiceInput
  resolveInput?: () => Promise<AtlasCloudVoiceInput>
  apiKey?: string
  resolveApiKey?: () => Promise<string>
  checkCancelled?: (stage: string) => Promise<void>
}): Promise<string> {
  const modelId = validateModelId(params.modelId)
  const { job } = params
  const jobExternalId = job.data.providerExternalId?.trim() || null
  let databaseExternalId = await getTaskExistingExternalId(job.data.taskId)
  const jobClaimId = job.data.payload
    && typeof job.data.payload === 'object'
    && !Array.isArray(job.data.payload)
    && typeof job.data.payload.voiceProviderSubmitClaimId === 'string'
    ? job.data.payload.voiceProviderSubmitClaimId.trim()
    : null

  if (jobExternalId && databaseExternalId && jobExternalId !== databaseExternalId) {
    if (databaseExternalId === jobClaimId && databaseExternalId.startsWith(CLAIM_PREFIX)) {
      await replaceTaskExternalIdOrThrow(job.data.taskId, databaseExternalId, jobExternalId)
      databaseExternalId = jobExternalId
    } else {
      throw quarantinePaidHandoff(job, 'ATLAS_AUDIO_PROVIDER_EXTERNAL_ID_CONFLICT')
    }
  }

  let externalId = databaseExternalId || jobExternalId
  if (externalId?.startsWith(CLAIM_PREFIX)) {
    throwForUnresolvedSubmitClaim(job, externalId)
  }

  let parsed: { modelId: string; predictionId: string } | null = null
  if (externalId) {
    try {
      parsed = parseAtlasCloudAudioExternalId(externalId)
    } catch (error) {
      throw quarantinePaidHandoff(job, 'ATLAS_AUDIO_PROVIDER_EXTERNAL_ID_QUARANTINED', error)
    }
    if (parsed.modelId !== modelId) {
      throw quarantinePaidHandoff(job, 'ATLAS_AUDIO_PROVIDER_EXTERNAL_ID_CONTEXT_MISMATCH')
    }
    if (!databaseExternalId) {
      await persistTaskExternalIdOrThrow(job.data.taskId, externalId)
    }
  }

  let apiKey: string | null = null
  if (!externalId) {
    const rawInput = params.input || await params.resolveInput?.()
    if (!rawInput) {
      throw providerError('ATLAS_AUDIO_PROVIDER_INPUT_REQUIRED', 'INVALID_PARAMS')
    }
    const input = normalizeVoiceInput(rawInput)
    apiKey = await resolveAtlasCloudApiKey({
      job,
      apiKey: params.apiKey,
      resolveApiKey: params.resolveApiKey,
      paidHandoff: false,
    })
    await params.checkCancelled?.('voice_line_pre_atlascloud_submit')

    const claimId = newSubmitClaimId()
    const claim = await claimTaskExternalId(job.data.taskId, claimId)
    if (!claim.claimed) {
      const winner = claim.externalId
      if (!winner) {
        throw quarantinePaidHandoff(
          job,
          'ATLAS_AUDIO_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED',
        )
      }
      if (winner.startsWith(CLAIM_PREFIX)) throwForUnresolvedSubmitClaim(job, winner)
      externalId = winner
    } else {
      let predictionId: string
      try {
        predictionId = await submitAtlasCloudAudioOnce({
          modelId,
          input,
          apiKey,
          checkCancelled: params.checkCancelled,
        })
      } catch (error) {
        if (isTaskCancellation(error)) throw error
        if (isDefinitiveSubmitRejection(error)) {
          try {
            await releaseRejectedProviderSubmitClaimOrThrow(job.data.taskId, claimId)
          } catch (releaseError) {
            throw quarantinePaidHandoff(
              job,
              'ATLAS_AUDIO_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED',
              releaseError,
            )
          }
          throw error
        }
        throw quarantinePaidHandoff(
          job,
          'ATLAS_AUDIO_PROVIDER_SUBMIT_OUTCOME_UNKNOWN',
          error,
        )
      }

      externalId = atlasCloudAudioExternalId(modelId, predictionId)
      try {
        const nextPayload = {
          ...(job.data.payload || {}),
          voiceProviderSubmitClaimId: claimId,
        }
        await job.updateData({
          ...job.data,
          payload: nextPayload,
          providerExternalId: externalId,
        })
        job.data.payload = nextPayload
        job.data.providerExternalId = externalId
      } catch {
        // Task.externalId is authoritative. BullMQ is only the secondary
        // response-loss checkpoint and must never block the DB replacement.
      }
      await replaceTaskExternalIdOrThrow(job.data.taskId, claimId, externalId)
    }
  }

  if (!parsed) {
    try {
      parsed = parseAtlasCloudAudioExternalId(externalId)
    } catch (error) {
      throw quarantinePaidHandoff(job, 'ATLAS_AUDIO_PROVIDER_EXTERNAL_ID_QUARANTINED', error)
    }
    if (parsed.modelId !== modelId) {
      throw quarantinePaidHandoff(job, 'ATLAS_AUDIO_PROVIDER_EXTERNAL_ID_CONTEXT_MISMATCH')
    }
  }

  await params.checkCancelled?.('voice_line_pre_atlascloud_poll')
  apiKey ||= await resolveAtlasCloudApiKey({
    job,
    apiKey: params.apiKey,
    resolveApiKey: params.resolveApiKey,
    paidHandoff: true,
  })

  const deadline = Date.now() + PROVIDER_POLL_TIMEOUT_MS
  while (Date.now() <= deadline) {
    await params.checkCancelled?.('voice_line_atlascloud_poll')
    let prediction: AtlasCloudPrediction
    try {
      prediction = await queryAtlasCloudAudioPrediction({
        predictionId: parsed.predictionId,
        apiKey,
        checkCancelled: params.checkCancelled,
      })
    } catch (error) {
      if (isTaskCancellation(error)) throw error
      const retryableError = (error as AtlasCloudVoiceError)?.code
        ? error
        : providerError('ATLAS_AUDIO_PROVIDER_STATUS_FAILED', 'EXTERNAL_ERROR', error)
      throwRetryablePaidHandoffErrorOrQuarantine(
        job,
        'ATLAS_AUDIO_PROVIDER_STATUS_QUARANTINED',
        retryableError,
      )
    }

    if (prediction.status === 'completed' || prediction.status === 'succeeded') {
      await params.checkCancelled?.('voice_line_pre_atlascloud_result')
      const outputUrl = prediction.outputs[0]
      if (!outputUrl) {
        throw providerError('ATLAS_AUDIO_PROVIDER_RESULT_AUDIO_MISSING', 'INVALID_PARAMS')
      }
      return outputUrl
    }
    if (prediction.status === 'failed') {
      throw providerError('ATLAS_AUDIO_PROVIDER_REQUEST_FAILED', 'INVALID_PARAMS')
    }
    if (prediction.status === 'timeout') {
      const timeoutError = providerError(
        'ATLAS_AUDIO_PROVIDER_REQUEST_TIMEOUT',
        'GENERATION_TIMEOUT',
      )
      throwRetryablePaidHandoffErrorOrQuarantine(
        job,
        'ATLAS_AUDIO_PROVIDER_TIMEOUT_QUARANTINED',
        timeoutError,
      )
    }
    if (prediction.status !== 'created' && prediction.status !== 'processing') {
      throw providerError('ATLAS_AUDIO_PROVIDER_STATUS_INVALID', 'INVALID_PARAMS')
    }
    await new Promise((resolve) => setTimeout(resolve, PROVIDER_POLL_INTERVAL_MS))
  }

  const pollTimeoutError = providerError(
    'ATLAS_AUDIO_PROVIDER_POLL_TIMEOUT',
    'GENERATION_TIMEOUT',
  )
  throwRetryablePaidHandoffErrorOrQuarantine(
    job,
    'ATLAS_AUDIO_PROVIDER_TIMEOUT_QUARANTINED',
    pollTimeoutError,
  )
}
