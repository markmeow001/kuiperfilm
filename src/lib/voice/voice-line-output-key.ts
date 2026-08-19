const VOICE_LINE_TASK_OUTPUT_KEY = /^voice\/[^/]+\/[^/]+\/[^/]+\/[a-f0-9]{32}-[a-f0-9]{64}\.wav$/

/**
 * Immutable storage namespace reserved for task-scoped VoiceLine output.
 * Other entities must never attach these keys as reusable media.
 */
export function isVoiceLineTaskOutputStorageKey(value: string): boolean {
  return VOICE_LINE_TASK_OUTPUT_KEY.test(value)
}
