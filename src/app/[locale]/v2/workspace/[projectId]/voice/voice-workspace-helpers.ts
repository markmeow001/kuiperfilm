import type { VoiceAsset, VoiceLine } from './voice-workspace-types'

export function getVoicePreviewUrl(voice: VoiceAsset): string | null {
  return voice.previewUrl || null
}

export function collectEpisodeSpeakers(voiceLines: VoiceLine[], projectSpeakers: string[]): string[] {
  const speakers = new Set<string>()
  for (const speaker of projectSpeakers) {
    const normalized = speaker.trim()
    if (normalized) speakers.add(normalized)
  }
  for (const line of voiceLines) {
    const normalized = line.speaker.trim()
    if (normalized) speakers.add(normalized)
  }
  return Array.from(speakers).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

export function filterVoiceAssets(
  voices: VoiceAsset[],
  search: string,
  gender: string,
): VoiceAsset[] {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  return voices.filter((voice) => {
    if (gender !== '全部' && voice.gender !== gender) return false
    if (!normalizedSearch) return true
    const searchable = [voice.name, voice.description, voice.gender]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')
      .toLocaleLowerCase()
    return searchable.includes(normalizedSearch)
  })
}

export function countGeneratableLines(
  voiceLines: VoiceLine[],
  boundSpeakers: ReadonlySet<string>,
): number {
  return voiceLines.filter((line) => !line.audioUrl && boundSpeakers.has(line.speaker)).length
}

export function clampEmotionStrength(value: number): number {
  if (!Number.isFinite(value)) return 0.4
  return Math.min(1, Math.max(0.1, value))
}
