import { TASK_TYPE } from '@/lib/task/types'

export const VOICE_SOURCE_CONSENT_REQUIRED = 'VOICE_SOURCE_CONSENT_REQUIRED' as const

/**
 * Legacy Asset Hub voice design has no durable source/consent record yet.
 * Call this before touching task payloads or emitting progress so even jobs
 * queued before the HTTP boundary was closed fail without provider effects.
 */
export function enforceVoiceDesignConsentBoundary(taskType: unknown): void {
  if (taskType === TASK_TYPE.ASSET_HUB_VOICE_DESIGN) {
    throw new Error(VOICE_SOURCE_CONSENT_REQUIRED)
  }
}
