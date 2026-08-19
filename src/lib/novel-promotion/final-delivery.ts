import { getSignedUrl, toFetchableUrl } from '@/lib/cos'
import { fetchPublicResource } from '@/lib/http/ssrf-safe-fetch'

export type EpisodePackageMediaKind = 'image' | 'video'

export type OwnedDeliveryStorageObject = {
  data: Buffer
  contentType: string
}

export const EPISODE_PACKAGE_ARCHIVE_MAX_SOURCE_BYTES = 768 * 1024 * 1024

const MEDIA_FETCH_POLICY = {
  image: {
    timeoutMs: 60_000,
    maxResponseBytes: 32 * 1024 * 1024,
    allowedContentTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/octet-stream',
    ] as const,
  },
  video: {
    timeoutMs: 120_000,
    maxResponseBytes: 256 * 1024 * 1024,
    allowedContentTypes: [
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'video/x-m4v',
      'application/octet-stream',
    ] as const,
  },
} as const

export class EpisodeDeliverySourceError extends Error {
  constructor(code = 'EPISODE_PACKAGE_SOURCE_INVALID') {
    super(code)
    this.name = 'EpisodeDeliverySourceError'
  }
}

function isSafeInternalStorageKey(value: string): boolean {
  if (!value || value !== value.trim() || value.length > 2048) return false
  if (!value.startsWith('images/') && !value.startsWith('video/')) return false
  if (
    value.startsWith('/')
    || value.includes('..')
    || value.includes('%')
    || /[\\?#\r\n\0]/.test(value)
    || /^(?:https?|data|file):/i.test(value)
  ) {
    return false
  }
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
}

/**
 * A scoped database row is the ownership proof. This helper additionally
 * requires the durable value to be a private internal object key so a legacy
 * raw URL can never turn the packaging worker into an arbitrary fetcher.
 */
export function requireOwnedDeliveryStorageKey(value: string | null | undefined): string {
  if (typeof value !== 'string' || !isSafeInternalStorageKey(value)) {
    throw new EpisodeDeliverySourceError()
  }
  return value
}

export function requireEpisodePackageStorageKey(
  episodeId: string,
  value: string | null | undefined,
): string {
  const key = requireOwnedDeliveryStorageKey(value)
  const prefix = `images/episode-pack-${episodeId}-`
  if (!key.startsWith(prefix) || !key.endsWith('.zip') || key.length <= prefix.length + 4) {
    throw new EpisodeDeliverySourceError('EPISODE_PACKAGE_OUTPUT_INVALID')
  }
  return key
}

export async function fetchOwnedDeliveryStorageObject(
  key: string,
  kind: EpisodePackageMediaKind,
): Promise<Buffer> {
  return (await fetchOwnedDeliveryStorageObjectWithMetadata(key, kind)).data
}

export async function fetchOwnedDeliveryStorageObjectWithMetadata(
  key: string,
  kind: EpisodePackageMediaKind,
): Promise<OwnedDeliveryStorageObject> {
  const ownedKey = requireOwnedDeliveryStorageKey(key)
  const fetchUrl = toFetchableUrl(getSignedUrl(ownedKey, 7200))
  let trustedOrigin: string
  try {
    trustedOrigin = new URL(fetchUrl).origin
  } catch {
    throw new EpisodeDeliverySourceError()
  }

  const response = await fetchPublicResource(fetchUrl, {
    ...MEDIA_FETCH_POLICY[kind],
    trustedInternalOrigins: [trustedOrigin],
  })
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error(`EPISODE_PACKAGE_UPSTREAM_HTTP_${response.status}`)
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (!contentType) {
    void response.body?.cancel().catch(() => undefined)
    throw new EpisodeDeliverySourceError('EPISODE_PACKAGE_CONTENT_TYPE_MISSING')
  }
  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType,
  }
}

export function deliveryMediaFileExtension(
  kind: EpisodePackageMediaKind,
  contentType: string,
): string {
  const extension = kind === 'image'
    ? ({
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      } as Record<string, string>)[contentType]
    : ({
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
        'video/x-m4v': 'm4v',
      } as Record<string, string>)[contentType]
  if (!extension) {
    throw new EpisodeDeliverySourceError('EPISODE_PACKAGE_CONTENT_TYPE_UNSUPPORTED')
  }
  return extension
}
