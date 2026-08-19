export function canvasAudioPlaybackUrl(input: {
  audioKey?: string | null
  audioUrl?: string | null
}): string | null {
  const audioKey = input.audioKey?.trim()
  if (audioKey) {
    return `/api/canvas/asset?key=${encodeURIComponent(audioKey)}`
  }
  const audioUrl = input.audioUrl?.trim()
  return audioUrl || null
}
