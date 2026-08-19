import { ApiError } from '@/lib/api-errors'
import {
  resolveCharacterVoiceWrite,
  VoiceSourceWritePolicyError,
  type CharacterVoiceWriteDecision,
} from '@/lib/voice/character-voice-write-policy'
import { VOICE_SOURCE_CONSENT_REQUIRED } from '@/lib/voice/voice-source-consent-policy'

export { VOICE_SOURCE_CONSENT_REQUIRED } from '@/lib/voice/voice-source-consent-policy'

/**
 * Legacy custom-human-voice writes stay closed until a durable source,
 * consent, and revocation model exists. This must be called immediately
 * after authentication and before reading request bodies or files.
 */
export function rejectLegacyCustomVoiceWrite(): never {
  throw new ApiError('INVALID_PARAMS', {
    reason: VOICE_SOURCE_CONSENT_REQUIRED,
  })
}

/**
 * API adapter for the pure character voice policy. Only an exact clear is
 * allowed; every new or partial legacy binding receives the same stable API
 * reason as the creation/upload/design endpoints.
 */
export function resolveLegacyCharacterVoiceWrite(
  input: unknown,
): CharacterVoiceWriteDecision {
  try {
    return resolveCharacterVoiceWrite(input)
  } catch (error) {
    if (error instanceof VoiceSourceWritePolicyError) {
      rejectLegacyCustomVoiceWrite()
    }
    throw error
  }
}
