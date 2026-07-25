export const SOURCE_AUDIO_MODES = [
  'preserve',
  'reference-only',
  'generate',
] as const

export type SourceAudioMode = (typeof SOURCE_AUDIO_MODES)[number]

export function isSourceAudioMode(value: unknown): value is SourceAudioMode {
  return SOURCE_AUDIO_MODES.some((mode) => mode === value)
}
