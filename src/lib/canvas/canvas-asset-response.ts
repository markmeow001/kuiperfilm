import { contentTypeForKey } from '@/lib/cos'

const IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const AUDIO_CONTENT_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
])

export function resolveCanvasAssetContentType(
  upstreamContentType: string,
  storageKey: string,
): string | null {
  const upstream = upstreamContentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (IMAGE_CONTENT_TYPES.has(upstream) || AUDIO_CONTENT_TYPES.has(upstream)) {
    return upstream
  }

  const inferred = contentTypeForKey(storageKey).split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (IMAGE_CONTENT_TYPES.has(inferred) || AUDIO_CONTENT_TYPES.has(inferred)) {
    return inferred
  }
  return null
}

export function canvasAssetMaxBytes(contentType: string): number {
  return AUDIO_CONTENT_TYPES.has(contentType)
    ? 32 * 1024 * 1024
    : 15 * 1024 * 1024
}
