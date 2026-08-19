export type AtlasCloudSeedAudioTextInput = {
  dialogue: string
  emotionPrompt?: string | null
  emotionStrength?: number | null
}

function invalidInput(field: string): Error & { code: 'INVALID_PARAMS' } {
  return Object.assign(new Error(`ATLAS_AUDIO_INPUT_INVALID:${field}`), {
    code: 'INVALID_PARAMS' as const,
  })
}

/** Atlas bills Unicode code points, not JavaScript UTF-16 code units. */
export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length
}

/**
 * Build the exact text sent to Seed Audio when the first reference is the
 * pinned speaker sample. This value is persisted in the task payload so the
 * billing quote and every retry use the same provider-visible characters.
 */
export function buildAtlasCloudSeedAudioText(input: AtlasCloudSeedAudioTextInput): string {
  const dialogue = input.dialogue.trim()
  if (!dialogue) throw invalidInput('dialogue')

  const emotionPrompt = input.emotionPrompt?.trim() || ''
  if (!emotionPrompt) return `@audio1 ${dialogue}`

  const strength = input.emotionStrength
  if (
    typeof strength !== 'number'
    || !Number.isFinite(strength)
    || strength < 0.1
    || strength > 1
  ) {
    throw invalidInput('emotionStrength')
  }

  return `@audio1 [emotion: ${emotionPrompt}; intensity: ${strength}] ${dialogue}`
}
