import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { isVoiceLineTaskOutputStorageKey } from '@/lib/voice/voice-line-output-key'
import { classifyVoiceLineTaskOutputReference } from './service'

/**
 * User-controlled media fields cannot point at immutable VoiceLine task
 * outputs. Those objects belong exclusively to their atomic publication
 * transaction and terminal cleanup marker.
 */
export async function assertUserMediaWriteReferenceAllowed(value: unknown): Promise<void> {
  const classification = await classifyVoiceLineTaskOutputReference(value)
  if (classification === 'other') return
  throw new ApiError('INVALID_PARAMS', {
    code: classification === 'reserved'
      ? 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN'
      : 'MEDIA_WRITE_REFERENCE_INVALID',
  })
}

/** Reject historical MediaObject relations that point at the reserved task namespace. */
export async function assertMediaObjectIdsDoNotReferenceVoiceLineTaskOutputs(
  values: unknown[],
): Promise<void> {
  const ids = [...new Set(values.filter((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  )).map((value) => value.trim()))]
  if (ids.length === 0) return

  const rows = await prisma.mediaObject.findMany({
    where: { id: { in: ids } },
    select: { storageKey: true },
  })
  if (rows.some((row) => isVoiceLineTaskOutputStorageKey(row.storageKey))) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN',
    })
  }
}
