import { createHash } from 'node:crypto'

export type ManualUploadEntityKind = 'character' | 'location' | 'prop'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeManualUploadIdempotencyKey(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error('INVALID_MANUAL_UPLOAD_IDEMPOTENCY_KEY')
  }
  return value.toLowerCase()
}

function deterministicUuid(input: string): string {
  const bytes = createHash('sha256').update(input).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function deriveManualUploadIds(
  kind: ManualUploadEntityKind,
  projectScopeId: string,
  requestId: string,
) {
  const namespace = `kuiper:manual-upload:${projectScopeId}:${kind}:${requestId}`
  return {
    entityId: deterministicUuid(`${namespace}:entity`),
    primaryAssetId: deterministicUuid(`${namespace}:primary-asset`),
    bindingId: deterministicUuid(`${namespace}:episode-binding`),
  }
}
