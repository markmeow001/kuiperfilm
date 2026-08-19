import { createHash } from 'node:crypto'

const CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeVoiceGenerationClientRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return CLIENT_REQUEST_ID_PATTERN.test(normalized) ? normalized : null
}

export function voiceLineGenerationDedupeKey(input: {
  lineId: string
}): string {
  return `voice_line:${input.lineId}`
}

/**
 * Stable UUID-shaped primary key for one immutable HTTP generation attempt.
 * UUID shape keeps the identifier compatible with BullMQ's custom job-id
 * restrictions while the hash makes a lost response replay addressable
 * without adding a database column.
 */
export function voiceLineGenerationTaskId(input: {
  userId: string
  clientRequestId: string
  lineId: string
}): string {
  const digest = sha256(`voice-line:v1\0${input.userId}\0${input.clientRequestId}\0${input.lineId}`)
  const versioned = `${digest.slice(0, 12)}5${digest.slice(13, 16)}`
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16)
  const uuidHex = `${versioned}${variant}${digest.slice(17, 32)}`
  return [
    uuidHex.slice(0, 8),
    uuidHex.slice(8, 12),
    uuidHex.slice(12, 16),
    uuidHex.slice(16, 20),
    uuidHex.slice(20, 32),
  ].join('-')
}

export function voiceLineGenerationIdempotencyFingerprint(input: {
  userId: string
  projectId: string
  episodeId: string
  lineId: string
  clientRequestId: string
  audioModel: string
  providerText: string
  maxSeconds: number
  sourceFingerprint: string
  requestFingerprint: string
}): string {
  return sha256(JSON.stringify({
    version: 1,
    userId: input.userId,
    projectId: input.projectId,
    episodeId: input.episodeId,
    lineId: input.lineId,
    clientRequestId: input.clientRequestId,
    audioModel: input.audioModel,
    providerText: input.providerText,
    maxSeconds: input.maxSeconds,
    sourceFingerprint: input.sourceFingerprint,
    requestFingerprint: input.requestFingerprint,
  }))
}

export function voiceGenerationRequestFingerprint(input: {
  userId: string
  projectId: string
  episodeId: string
  clientRequestId: string
  mode: 'single' | 'batch'
  lineIds: readonly string[]
  requestedAudioModel: string
}): string {
  return sha256(JSON.stringify({
    version: 1,
    userId: input.userId,
    projectId: input.projectId,
    episodeId: input.episodeId,
    clientRequestId: input.clientRequestId,
    mode: input.mode,
    lineIds: [...input.lineIds],
    requestedAudioModel: input.requestedAudioModel,
  }))
}
