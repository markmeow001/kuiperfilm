import { TASK_TYPE } from '@/lib/task/types'

const ATLASCLOUD_AUDIO_PREFIX = 'ATLASCLOUD:AUDIO:'
const ATLASCLOUD_AUDIO_CLAIM_PREFIX = 'ATLASCLOUD:AUDIO:CLAIM:'
const FAL_VOICE_PREFIX = 'FAL:VOICE:'
const FAL_VOICE_CLAIM_PREFIX = 'FAL:VOICE:CLAIM:'

export type PaidVoiceProvider = 'atlascloud' | 'fal'
export type PaidVoiceProviderTerminalStatus = 'failed' | 'timeout'

export type PaidVoiceProviderHandoffClassification =
  | { kind: 'not_applicable'; externalId: string | null }
  | { kind: 'none'; externalId: null }
  | { kind: 'claim'; externalId: string }
  | { kind: 'malformed'; externalId: string }
  | { kind: 'actual'; provider: PaidVoiceProvider; externalId: string }

export type VoiceLineProviderHandoff = {
  type: string
  externalId: string | null
}

export function isPaidVoiceProviderTaskType(type: string): boolean {
  return type === TASK_TYPE.VOICE_LINE || type === TASK_TYPE.CANVAS_TTS
}

function isActualProviderId(value: string, prefix: string): boolean {
  const remainder = value.slice(prefix.length)
  const separator = remainder.lastIndexOf(':')
  if (separator <= 0) return false
  const modelId = remainder.slice(0, separator)
  const providerRequestId = remainder.slice(separator + 1)
  return modelId.length > 0
    && providerRequestId.length > 0
    && modelId.trim() === modelId
    && providerRequestId.trim() === providerRequestId
}

export function classifyPaidVoiceProviderHandoff(
  task: VoiceLineProviderHandoff,
): PaidVoiceProviderHandoffClassification {
  const raw = typeof task.externalId === 'string' ? task.externalId : null
  if (!isPaidVoiceProviderTaskType(task.type)) {
    return { kind: 'not_applicable', externalId: raw }
  }

  const externalId = raw?.trim() || ''
  if (!externalId) return { kind: 'none', externalId: null }
  if (raw !== externalId) return { kind: 'malformed', externalId: raw! }
  if (
    externalId.startsWith(ATLASCLOUD_AUDIO_CLAIM_PREFIX)
    || externalId.startsWith(FAL_VOICE_CLAIM_PREFIX)
  ) {
    return { kind: 'claim', externalId }
  }
  if (
    externalId.startsWith(ATLASCLOUD_AUDIO_PREFIX)
    && isActualProviderId(externalId, ATLASCLOUD_AUDIO_PREFIX)
  ) {
    return { kind: 'actual', provider: 'atlascloud', externalId }
  }
  if (
    externalId.startsWith(FAL_VOICE_PREFIX)
    && isActualProviderId(externalId, FAL_VOICE_PREFIX)
  ) {
    return { kind: 'actual', provider: 'fal', externalId }
  }
  return { kind: 'malformed', externalId }
}

export function paidVoiceProviderTerminalErrorCode(
  status: PaidVoiceProviderTerminalStatus,
): 'VOICE_PROVIDER_TERMINAL_FAILED' | 'VOICE_PROVIDER_TERMINAL_TIMEOUT' {
  return status === 'failed'
    ? 'VOICE_PROVIDER_TERMINAL_FAILED'
    : 'VOICE_PROVIDER_TERMINAL_TIMEOUT'
}

export function isSafelyTerminalPaidVoiceProviderFailure(task: VoiceLineProviderHandoff & {
  status: string
  errorCode?: string | null
}): boolean {
  if (task.status !== 'failed') return false
  const handoff = classifyPaidVoiceProviderHandoff(task)
  if (handoff.kind !== 'actual') return false
  return task.errorCode === paidVoiceProviderTerminalErrorCode('failed')
    || task.errorCode === paidVoiceProviderTerminalErrorCode('timeout')
}

export function isProtectedVoiceLineProviderHandoff(
  task: VoiceLineProviderHandoff,
): boolean {
  const handoff = classifyPaidVoiceProviderHandoff(task)
  return handoff.kind === 'claim'
    || handoff.kind === 'malformed'
    || handoff.kind === 'actual'
}
