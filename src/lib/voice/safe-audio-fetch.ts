import { fetchPublicResource } from '@/lib/http/ssrf-safe-fetch'

export const VOICE_AUDIO_TIMEOUT_MS = 60_000
export const VOICE_AUDIO_MAX_BYTES = 32 * 1024 * 1024
export const VOICE_AUDIO_CONTENT_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'application/octet-stream',
] as const

export async function fetchVoiceAudioResource(
  url: string,
  options?: { trustedInternalOrigins?: readonly string[] },
): Promise<{ data: Buffer; contentType: string }> {
  const response = await fetchPublicResource(url, {
    timeoutMs: VOICE_AUDIO_TIMEOUT_MS,
    maxResponseBytes: VOICE_AUDIO_MAX_BYTES,
    allowedContentTypes: VOICE_AUDIO_CONTENT_TYPES,
    ...(options?.trustedInternalOrigins
      ? { trustedInternalOrigins: options.trustedInternalOrigins }
      : {}),
  })
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error(`VOICE_AUDIO_UPSTREAM_STATUS_${response.status}`)
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (!contentType) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error('VOICE_AUDIO_CONTENT_TYPE_MISSING')
  }
  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType,
  }
}
