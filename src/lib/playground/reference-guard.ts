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

const KEY_PREFIXES = ['images/', 'video/', 'voice/']

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
