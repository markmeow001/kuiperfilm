import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { extractCOSKey, getSignedUrl } from '@/lib/cos'
import { stablePublicIdFromStorageKey } from './hash'
import { isVoiceLineTaskOutputStorageKey } from '@/lib/voice/voice-line-output-key'
import type { MediaRef } from './types'

type MediaObjectRow = {
  id: string
  publicId: string
  storageKey: string
  sha256: string | null
  mimeType: string | null
  sizeBytes: bigint | number | null
  width: number | null
  height: number | null
  durationMs: number | null
  updatedAt: Date | string
  uploadedByUserId?: string | null
}

/**
 * Q-005: ownership context for MediaObject creation.
 * Passed all the way from the request handler / worker handler so the row is tagged
 * with the original uploader. Required for cross-user reference protection in
 * styleProfile + similar features.
 */
export interface MediaObjectOwnerContext {
  uploadedByUserId: string | null
}

type MediaModel = {
  findUnique: (args: unknown) => Promise<unknown>
  upsert: (args: unknown) => Promise<unknown>
  update: (args: unknown) => Promise<unknown>
}

const mediaModel = (prisma as unknown as { mediaObject: MediaModel }).mediaObject

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

function normalizeStorageKey(value: string): string {
  return value.trim().replace(/^\/+/, '')
}

function isLikelyExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function guessMimeTypeFromStorageKey(storageKey: string): string | null {
  const ext = path.extname(storageKey).toLowerCase()
  return MIME_BY_EXT[ext] || null
}

function mediaUrl(publicId: string): string {
  return `/m/${encodeURIComponent(publicId)}`
}

function parseHttpUrl(value: string): URL | null {
  const candidate = value.startsWith('//') ? `https:${value}` : value
  if (!/^https?:\/\//i.test(candidate)) return null
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

function extractPublicIdFromMediaRoute(value: string): string | null {
  const normalized = value.trim()
  const parsedUrl = parseHttpUrl(normalized)
  const routePart = parsedUrl
    ? parsedUrl.pathname
    : normalized.split('?')[0]?.split('#')[0] || ''
  if (!routePart.startsWith('/m/')) return null
  const encoded = routePart.slice('/m/'.length).replace(/^\/+/, '')
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

function mapMediaObjectToRef(row: MediaObjectRow): MediaRef {
  return {
    id: row.id,
    publicId: row.publicId,
    url: mediaUrl(row.publicId),
    sha256: row.sha256,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes),
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    storageKey: row.storageKey,
  }
}

export async function ensureMediaObjectFromStorageKey(
  rawStorageKey: string,
  metadata?: Partial<Pick<MediaRef, 'mimeType' | 'sizeBytes' | 'width' | 'height' | 'durationMs'>>,
  owner?: MediaObjectOwnerContext,
): Promise<MediaRef> {
  const storageKey = normalizeStorageKey(rawStorageKey)
  if (isVoiceLineTaskOutputStorageKey(storageKey)) {
    throw new Error('VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN')
  }

  const existing = (await mediaModel.findUnique({ where: { storageKey } })) as MediaObjectRow | null
  if (existing != null) {
    // Q-005: backfill uploadedByUserId on lazy resolves when the row had none and
    // we now have a known owner context.  Never overwrite an existing owner.
    if (
      owner?.uploadedByUserId &&
      (existing.uploadedByUserId == null || existing.uploadedByUserId === '')
    ) {
      const updated = (await mediaModel.update({
        where: { id: existing.id },
        data: { uploadedByUserId: owner.uploadedByUserId },
      })) as MediaObjectRow
      return mapMediaObjectToRef(updated)
    }
    return mapMediaObjectToRef(existing)
  }

  const publicId = stablePublicIdFromStorageKey(storageKey)
  try {
    const created = (await mediaModel.upsert({
      where: { publicId },
      update: {
        storageKey,
        mimeType: metadata?.mimeType ?? guessMimeTypeFromStorageKey(storageKey),
        sizeBytes: metadata?.sizeBytes == null ? undefined : BigInt(metadata.sizeBytes),
        width: metadata?.width ?? undefined,
        height: metadata?.height ?? undefined,
        durationMs: metadata?.durationMs ?? undefined,
        // only fill owner on update if currently null and we have a context
        ...(owner?.uploadedByUserId ? { uploadedByUserId: owner.uploadedByUserId } : {}),
      },
      create: {
        publicId,
        storageKey,
        mimeType: metadata?.mimeType ?? guessMimeTypeFromStorageKey(storageKey),
        sizeBytes: metadata?.sizeBytes == null ? null : BigInt(metadata.sizeBytes),
        width: metadata?.width ?? null,
        height: metadata?.height ?? null,
        durationMs: metadata?.durationMs ?? null,
        uploadedByUserId: owner?.uploadedByUserId ?? null,
      },
    })) as MediaObjectRow

    return mapMediaObjectToRef(created)
  } catch (error: unknown) {
    // P2002 = unique constraint violation. Another concurrent request already
    // created/updated the row.  Re-fetch instead of crashing.
    const code = (error as { code?: string })?.code
    if (code === 'P2002') {
      const fallback = (await mediaModel.findUnique({ where: { publicId } })) as MediaObjectRow | null
        ?? (await mediaModel.findUnique({ where: { storageKey } })) as MediaObjectRow | null
      if (fallback) return mapMediaObjectToRef(fallback)
    }
    throw error
  }
}

export async function getMediaObjectByPublicId(publicId: string) {
  const row = (await mediaModel.findUnique({ where: { publicId } })) as MediaObjectRow | null
  if (!row) return null
  return mapMediaObjectToRef(row)
}

export async function getMediaObjectById(id: string) {
  const row = (await mediaModel.findUnique({ where: { id } })) as MediaObjectRow | null
  if (!row) return null
  return mapMediaObjectToRef(row)
}

/**
 * 将任意媒体值（COS key / 签名URL / /m/publicId / 对象形态）归一化为 storageKey。
 * 这是服务端写路径（保存、比较、删除）应使用的唯一入口。
 */
export async function resolveStorageKeyFromMediaValue(value: unknown): Promise<string | null> {
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!normalized) return null
    const publicId = extractPublicIdFromMediaRoute(normalized)
    if (publicId) {
      const media = await getMediaObjectByPublicId(publicId)
      return media?.storageKey || null
    }
    const parsedUrl = parseHttpUrl(normalized)
    const key = extractCOSKey(parsedUrl?.toString() ?? normalized)
    return key ? normalizeStorageKey(key) : null
  }

  if (value && typeof value === 'object') {
    const maybeValue = (value as { url?: unknown; imageUrl?: unknown; key?: unknown }).url
      ?? (value as { imageUrl?: unknown }).imageUrl
      ?? (value as { key?: unknown }).key
    return resolveStorageKeyFromMediaValue(maybeValue)
  }

  return null
}

export async function classifyVoiceLineTaskOutputReference(
  value: unknown,
): Promise<'other' | 'reserved' | 'unresolved_media_alias'> {
  if (typeof value !== 'string' || !value.trim()) return 'other'
  const normalized = value.trim()
  const isMediaAlias = extractPublicIdFromMediaRoute(normalized) !== null
  const storageKey = await resolveStorageKeyFromMediaValue(normalized)
  if (isMediaAlias && !storageKey) return 'unresolved_media_alias'
  return storageKey && isVoiceLineTaskOutputStorageKey(normalizeStorageKey(storageKey))
    ? 'reserved'
    : 'other'
}

export function extractStorageKeyFromLegacyValue(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = value.trim()
  if (extractPublicIdFromMediaRoute(normalized)) return null
  const parsedUrl = parseHttpUrl(normalized)

  // Keep external URLs that are actually COS object URLs (path -> key).
  if (isLikelyExternalUrl(normalized) || normalized.startsWith('/api/files/') || !normalized.startsWith('/')) {
    const key = extractCOSKey(parsedUrl?.toString() ?? normalized)
    return key ? normalizeStorageKey(key) : null
  }

  return null
}

export async function resolveMediaRefFromLegacyValue(
  value: unknown,
  owner?: MediaObjectOwnerContext,
): Promise<MediaRef | null> {
  const classification = await classifyVoiceLineTaskOutputReference(value)
  if (classification === 'unresolved_media_alias') {
    if (owner?.uploadedByUserId) {
      throw new Error('MEDIA_WRITE_REFERENCE_INVALID')
    }
    return null
  }
  if (classification === 'reserved') {
    throw new Error('VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN')
  }
  const storageKey = extractStorageKeyFromLegacyValue(value)
  if (!storageKey) return null
  return ensureMediaObjectFromStorageKey(storageKey, undefined, owner)
}

/**
 * VoiceLine task outputs are immutable publication artifacts, not reusable
 * MediaObjects. Serialize them through a virtual signed ref so a read never
 * creates a database reference that would permanently block terminal cleanup.
 */
export async function resolveVoiceLineMediaRef(
  mediaId: unknown,
  legacyValue: unknown,
): Promise<MediaRef | null> {
  if (typeof mediaId === 'string' && mediaId.trim()) {
    const mediaById = await getMediaObjectById(mediaId)
    if (mediaById && !isVoiceLineTaskOutputStorageKey(mediaById.storageKey ?? '')) {
      return mediaById
    }
    if (mediaById?.storageKey) legacyValue = mediaById.storageKey
  }

  const storageKey = await resolveStorageKeyFromMediaValue(legacyValue)
  if (storageKey && isVoiceLineTaskOutputStorageKey(normalizeStorageKey(storageKey))) {
    const canonicalKey = normalizeStorageKey(storageKey)
    const publicId = stablePublicIdFromStorageKey(canonicalKey)
    return {
      id: `voice-line-output:${publicId}`,
      publicId,
      url: getSignedUrl(canonicalKey),
      mimeType: 'audio/wav',
      sizeBytes: null,
      width: null,
      height: null,
      durationMs: null,
      sha256: null,
      updatedAt: null,
      storageKey: canonicalKey,
    }
  }

  return resolveMediaRefFromLegacyValue(legacyValue)
}

export async function resolveMediaRef(
  mediaId: unknown,
  legacyValue: unknown,
  owner?: MediaObjectOwnerContext,
): Promise<MediaRef | null> {
  if (typeof mediaId === 'string' && mediaId.trim()) {
    const mediaById = await getMediaObjectById(mediaId)
    if (mediaById) return mediaById
  }
  return resolveMediaRefFromLegacyValue(legacyValue, owner)
}

export async function resolveMediaRefsFromLegacyJsonArray(
  jsonStr: unknown,
  owner?: MediaObjectOwnerContext,
): Promise<MediaRef[]> {
  if (typeof jsonStr !== 'string' || !jsonStr.trim()) return []
  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return []

    const refs = await Promise.all(
      parsed
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => resolveMediaRefFromLegacyValue(v, owner)),
    )

    return refs.filter((v): v is MediaRef => !!v)
  } catch {
    return []
  }
}

export function mediaUrlFromRef(ref: MediaRef | null | undefined, fallback: string | null | undefined): string | null {
  if (ref?.url) return ref.url
  return fallback || null
}
