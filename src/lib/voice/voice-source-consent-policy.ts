import { TASK_TYPE } from '@/lib/task/types'

export const VOICE_SOURCE_CONSENT_REQUIRED = 'VOICE_SOURCE_CONSENT_REQUIRED' as const

const CONSENT_GATED_VOICE_DESIGN_TASK_TYPES: ReadonlySet<string> = new Set([
  TASK_TYPE.VOICE_DESIGN,
  TASK_TYPE.ASSET_HUB_VOICE_DESIGN,
])

/**
 * AI voice design has no durable source/consent/revocation record yet, in
 * either the project or the Asset Hub entry point. Both produce the same
 * unauditable synthetic human voice from the same paid provider, so both are
 * gated identically.
 *
 * Call this before touching task payloads or emitting progress so even jobs
 * queued before the HTTP boundary was closed fail without provider effects.
 */
export function enforceVoiceDesignConsentBoundary(taskType: unknown): void {
  if (typeof taskType === 'string' && CONSENT_GATED_VOICE_DESIGN_TASK_TYPES.has(taskType)) {
    throw new Error(VOICE_SOURCE_CONSENT_REQUIRED)
  }
}
