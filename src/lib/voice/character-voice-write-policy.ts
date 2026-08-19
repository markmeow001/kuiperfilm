export const CHARACTER_VOICE_SOURCE_FIELDS = [
  'voiceId',
  'voiceType',
  'customVoiceUrl',
] as const

export type CharacterVoiceClearData = {
  voiceId: null
  voiceType: null
  customVoiceUrl: null
  customVoiceMediaId: null
}

export type CharacterVoiceWriteDecision =
  | { kind: 'none' }
  | { kind: 'clear'; data: CharacterVoiceClearData }

export class VoiceSourceWritePolicyError extends Error {
  readonly code = 'VOICE_SOURCE_CONSENT_REQUIRED' as const

  constructor() {
    super('VOICE_SOURCE_CONSENT_REQUIRED')
    this.name = 'VoiceSourceWritePolicyError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * No-migration durable voice-source boundary.
 *
 * Until VoiceSource + Consent + Revocation records exist, character writes
 * may omit voice fields or explicitly clear all legacy fields. Any partial
 * write or non-null source would create an unauditable durable binding and is
 * rejected regardless of whether it looks like a provider id, URL, or /m ref.
 */
export function resolveCharacterVoiceWrite(input: unknown): CharacterVoiceWriteDecision {
  if (!isRecord(input)) return { kind: 'none' }

  const presentFields = CHARACTER_VOICE_SOURCE_FIELDS.filter((field) => (
    Object.prototype.hasOwnProperty.call(input, field)
  ))
  const hasDurableMediaField = Object.prototype.hasOwnProperty.call(input, 'customVoiceMediaId')
  if (presentFields.length === 0 && !hasDurableMediaField) return { kind: 'none' }

  // A durable media relation is also a voice source. Without an ownership +
  // consent record it must never be accepted, even when the legacy URL/id
  // fields are explicitly cleared.
  if (hasDurableMediaField && input.customVoiceMediaId !== null) {
    throw new VoiceSourceWritePolicyError()
  }

  if (
    presentFields.length === CHARACTER_VOICE_SOURCE_FIELDS.length
    && CHARACTER_VOICE_SOURCE_FIELDS.every((field) => input[field] === null)
  ) {
    return {
      kind: 'clear',
      data: {
        voiceId: null,
        voiceType: null,
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    }
  }

  throw new VoiceSourceWritePolicyError()
}
