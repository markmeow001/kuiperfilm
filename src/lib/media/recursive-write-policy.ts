import { ApiError } from '@/lib/api-errors'
import { classifyVoiceLineTaskOutputReference } from './service'

/**
 * Reject immutable VoiceLine task outputs anywhere inside free-form persisted
 * JSON. The iterative walk avoids call-stack exhaustion on deeply nested input;
 * the WeakSet also makes the helper safe for internal callers with cyclic data.
 */
export async function assertNoVoiceLineTaskOutputReferences(value: unknown): Promise<void> {
  const pending: unknown[] = [value]
  const visited = new WeakSet<object>()

  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'string') {
      const classification = await classifyVoiceLineTaskOutputReference(current)
      if (classification === 'reserved') {
        throw new ApiError('INVALID_PARAMS', {
          code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN',
        })
      }
      const trimmed = current.trim()
      if (classification === 'other' && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
        try {
          pending.push(JSON.parse(trimmed) as unknown)
        } catch {
          // Ordinary text may begin with JSON punctuation. Only valid persisted
          // JSON is traversed; malformed strings remain ordinary values.
        }
      }
      continue
    }

    if (current === null || typeof current !== 'object' || visited.has(current)) {
      continue
    }
    visited.add(current)

    if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry)
      continue
    }
    for (const entry of Object.values(current as Record<string, unknown>)) {
      pending.push(entry)
    }
  }
}
