/**
 * Reference-image/video guard for the Playground/Canvas run boundary.
 *
 * Closes two real issues in the reference pipeline:
 *  - C1 cross-user COS read: a client sends a bare COS key; the worker signs ANY
 *    `images/|video/|voice/` key with no ownership check → a user could read
 *    another user's object by sending their key. Fix: a bare key MUST be in the
 *    caller's own upload namespace (`/playground-ref/<userId>/`). (Keys are only
 *    ever signed by us, so a foreign key is the only cross-user-read vector — a
 *    signed URL can't be forged.)
 *  - C2 SSRF: a non-key string passes through as a literal URL the worker may
 *    fetch. Fix: reject non-https and internal/private/loopback/metadata hosts.
 *    Legit COS/R2 https signed URLs pass (their signature can't be forged, so no
 *    cross-user read), arbitrary external https is harmless (same as any ref).
 */

import { prisma } from '@/lib/prisma'

const KEY_PREFIXES = ['images/', 'video/', 'voice/']

interface CanvasAssetReferenceRow {
  ownerUserId: string
  workspaceId: string | null
}

type CanvasAssetReferenceModel = {
  findMany(args: unknown): Promise<CanvasAssetReferenceRow[]>
}

const canvasAssetModel = (prisma as unknown as { canvasAsset: CanvasAssetReferenceModel }).canvasAsset

function isPrivateOrInternalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0') return true
  if (h.includes(':')) return true // raw IPv6 — block
  // raw IPv4 — block all (no legit storage host is a bare IP); covers metadata
  // 169.254.169.254, 127.x, 10.x, 192.168.x, 172.16-31.x, etc.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true
  return false
}

/** True if a single reference entry is safe to accept for this caller. */
export function isSafeReference(entry: string, userId: string): boolean {
  if (typeof entry !== 'string' || !entry.trim()) return false
  const v = entry.trim()

  // bare COS key → must be in the caller's own ref-upload namespace
  if (KEY_PREFIXES.some((p) => v.startsWith(p))) {
    return v.includes(`/playground-ref/${userId}/`)
  }

  // relative app path (local storage) → only the files endpoint, no traversal
  if (v.startsWith('/')) {
    return v.startsWith('/api/files/') && !v.includes('..')
  }

  // absolute URL → https only, no internal/private host
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:') return false
    return !isPrivateOrInternalHost(u.hostname)
  } catch {
    return false
  }
}

/**
 * Filter a reference list to the entries safe for this caller, returning the
 * kept entries + how many were rejected (for logging). Never throws.
 */
export function filterSafeReferences(
  entries: string[],
  userId: string,
): { safe: string[]; rejected: string[] } {
  const safe: string[] = []
  const rejected: string[] = []
  for (const e of entries) {
    if (isSafeReference(e, userId)) safe.push(e)
    else rejected.push(e)
  }
  return { safe, rejected }
}

function isBareStorageKey(entry: string): boolean {
  return KEY_PREFIXES.some((prefix) => entry.startsWith(prefix))
}

async function canReadRegisteredCanvasAsset(storageKey: string, userId: string): Promise<boolean> {
  const assets = await canvasAssetModel.findMany({
    where: { storageKey },
    select: { ownerUserId: true, workspaceId: true },
  })
  if (assets.some((asset) => asset.workspaceId === null && asset.ownerUserId === userId)) return true

  const workspaceIds = [...new Set(
    assets
      .map((asset) => asset.workspaceId)
      .filter((workspaceId): workspaceId is string => typeof workspaceId === 'string' && workspaceId.length > 0),
  )]
  if (workspaceIds.length === 0) return false
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: { in: workspaceIds },
      OR: [
        { ownerEditorId: userId },
        { members: { some: { userId } } },
      ],
    },
    select: { id: true },
  })
  return Boolean(workspace)
}

async function canReadBareStorageKey(storageKey: string, userId: string): Promise<boolean> {
  if (!isBareStorageKey(storageKey)) return false
  if (isSafeReference(storageKey, userId)) return true
  return await canReadRegisteredCanvasAsset(storageKey, userId)
}

/**
 * Strict storage-only authorization for server-side media processing.
 *
 * Unlike normal Playground references, this intentionally rejects absolute
 * URLs and local app paths. ffprobe/ffmpeg must only receive a URL that the
 * worker derived from an authorized first-party storage key; otherwise an
 * attacker-controlled URL would become an SSRF-capable media input.
 */
export async function filterAuthorizedStorageReferences(
  entries: string[],
  userId: string,
): Promise<{ safe: string[]; rejected: string[] }> {
  const safe: string[] = []
  const rejected: string[] = []
  for (const entry of entries) {
    const normalized = entry.trim()
    if (normalized && await canReadBareStorageKey(normalized, userId)) {
      safe.push(normalized)
      continue
    }
    rejected.push(entry)
  }
  return { safe, rejected }
}

/**
 * Playground boundary authorization. Normal safe references keep the cheap
 * synchronous path; otherwise a bare durable key is accepted only when it is
 * registered in CanvasAsset and the caller can read that exact asset scope.
 */
export async function filterAuthorizedReferences(
  entries: string[],
  userId: string,
): Promise<{ safe: string[]; rejected: string[] }> {
  const safe: string[] = []
  const rejected: string[] = []
  for (const entry of entries) {
    if (isSafeReference(entry, userId)) {
      safe.push(entry)
      continue
    }
    const normalized = entry.trim()
    if (await canReadBareStorageKey(normalized, userId)) {
      safe.push(normalized)
      continue
    }
    rejected.push(entry)
  }
  return { safe, rejected }
}
