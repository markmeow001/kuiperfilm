export interface GenerateProjectVoiceVariables {
  episodeId: string
  lineId?: string
  all?: boolean
  lineIds?: string[]
}

export interface GenerateProjectVoiceResponse {
  success?: boolean
  async?: boolean
  taskId?: string
  taskIds?: string[]
  total?: number
  error?: string
  results?: Array<{ audioUrl?: string }>
}

export interface VoiceGenerationRequestPin {
  clientRequestId: string
  actionFingerprint: string
}

export interface VoiceGenerationRequestStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface VoiceGenerationRequestStorageScope {
  projectId: string
  actionFingerprint: string
}

const CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_STORAGE_PREFIX = 'kuiper:voice-generation-request:v1'

function normalizedRequestBody(variables: GenerateProjectVoiceVariables) {
  return variables.all === true
    ? {
        episodeId: variables.episodeId,
        all: true as const,
        lineIds: [...(variables.lineIds ?? [])].sort((left, right) => left.localeCompare(right)),
      }
    : { episodeId: variables.episodeId, lineId: variables.lineId }
}

export function voiceGenerationActionFingerprint(
  variables: GenerateProjectVoiceVariables,
): string {
  const body = normalizedRequestBody(variables)
  return JSON.stringify(body)
}

export function pinVoiceGenerationClientRequest(
  variables: GenerateProjectVoiceVariables,
  previous: VoiceGenerationRequestPin | null,
  createId: () => string = () => globalThis.crypto.randomUUID(),
): {
  pin: VoiceGenerationRequestPin
  body: ReturnType<typeof normalizedRequestBody> & { clientRequestId: string }
} {
  const actionFingerprint = voiceGenerationActionFingerprint(variables)
  const pin = previous?.actionFingerprint === actionFingerprint
    ? previous
    : { clientRequestId: createId(), actionFingerprint }
  return {
    pin,
    body: { ...normalizedRequestBody(variables), clientRequestId: pin.clientRequestId },
  }
}

export function voiceGenerationRequestStorageKey(
  scope: VoiceGenerationRequestStorageScope,
): string {
  const projectId = scope.projectId.trim()
  if (!projectId || !scope.actionFingerprint) {
    throw new Error('Voice generation request storage requires project/action scope')
  }
  return `${REQUEST_STORAGE_PREFIX}:${encodeURIComponent(projectId)}:${encodeURIComponent(scope.actionFingerprint)}`
}

export function readVoiceGenerationRequestPin(
  storage: VoiceGenerationRequestStorage,
  scope: VoiceGenerationRequestStorageScope,
): VoiceGenerationRequestPin | null {
  const raw = storage.getItem(voiceGenerationRequestStorageKey(scope))
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Voice generation request identity storage is corrupted')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Voice generation request identity storage is corrupted')
  }
  const record = value as Record<string, unknown>
  const normalizedRequestId = typeof record.clientRequestId === 'string'
    ? record.clientRequestId.trim().toLowerCase()
    : ''
  if (
    !CLIENT_REQUEST_ID_PATTERN.test(normalizedRequestId)
    || record.actionFingerprint !== scope.actionFingerprint
  ) {
    throw new Error('Voice generation request identity storage is corrupted')
  }
  return {
    clientRequestId: normalizedRequestId,
    actionFingerprint: scope.actionFingerprint,
  }
}

export function writeVoiceGenerationRequestPin(
  storage: VoiceGenerationRequestStorage,
  scope: VoiceGenerationRequestStorageScope,
  pin: VoiceGenerationRequestPin,
): void {
  if (
    pin.actionFingerprint !== scope.actionFingerprint
    || !CLIENT_REQUEST_ID_PATTERN.test(pin.clientRequestId)
  ) {
    throw new Error('Voice generation request identity does not match storage scope')
  }
  storage.setItem(voiceGenerationRequestStorageKey(scope), JSON.stringify(pin))
}

export function clearVoiceGenerationRequestPin(
  storage: VoiceGenerationRequestStorage,
  scope: VoiceGenerationRequestStorageScope,
): void {
  storage.removeItem(voiceGenerationRequestStorageKey(scope))
}

export function tryReadVoiceGenerationRequestPin(
  storage: VoiceGenerationRequestStorage,
  scope: VoiceGenerationRequestStorageScope,
): VoiceGenerationRequestPin | null {
  try {
    return readVoiceGenerationRequestPin(storage, scope)
  } catch {
    // A corrupt browser record cannot be a trustworthy paid-request identity.
    // Remove that exact scoped record and start a fresh logical action.
    clearVoiceGenerationRequestPin(storage, scope)
    return null
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function requireValidVoiceGenerationResponse(
  value: GenerateProjectVoiceResponse,
  variables: GenerateProjectVoiceVariables,
): GenerateProjectVoiceResponse {
  if (value.success !== true || value.async !== true) {
    throw new Error('Invalid voice generation response')
  }

  if (variables.all === true) {
    const taskIds = value.taskIds
    const expectedTotal = variables.lineIds?.length ?? 0
    if (
      !Array.isArray(taskIds)
      || !taskIds.every(isNonEmptyString)
      || !Number.isInteger(value.total)
      || value.total !== taskIds.length
      || value.total !== expectedTotal
    ) {
      throw new Error('Invalid voice generation response')
    }
    return value
  }

  if (!isNonEmptyString(value.taskId)) {
    throw new Error('Invalid voice generation response')
  }
  return value
}

/**
 * A response can be known to have rejected a submission only for deterministic
 * 4xx statuses. Network loss, timeout/throttling, server errors, and a malformed
 * 2xx acknowledgement can all happen after the server created the paid Task.
 */
export function shouldRetainVoiceGenerationRequestId(status: number | null): boolean {
  return status === null
    || status === 408
    || status === 429
    || (status >= 200 && status < 300)
    || status >= 500
}
