/**
 * API key generator + hash + parse — Phase 5 (2026-05-25).
 *
 * Key format:
 *   `kfk_<prefix-8-chars>_<secret-32-chars>`
 *
 *   - `kfk_`: brand prefix (KuiperAI Film Key), mirrors PolyFilm `pfk_`,
 *     Stripe `sk_/pk_`. Makes the key recognizable in logs / leak scans.
 *   - `<prefix-8-chars>`: base62, used as the DB lookup index. Stored
 *     plaintext in ApiKey.keyPrefix; not a secret.
 *   - `<secret-32-chars>`: base62, the actual auth material. SHA-256
 *     hashed into ApiKey.keyHash. Only ever shown to the user once at
 *     creation time (reveal-once UX).
 *
 * Total length: 4 + 8 + 1 + 32 = 45 chars. Enough entropy (32 × log2(62)
 * ≈ 190 bits) to resist offline brute force even if the hash leaks.
 *
 * Why a separate `prefix` instead of putting the full secret in the
 * lookup index: hash compare is O(1) but you still need a row to
 * compare against. The prefix lets the middleware do a single indexed
 * SELECT before doing the constant-time hash check.
 */

import crypto from 'node:crypto'

const BRAND_PREFIX = 'kfk_'
const PREFIX_LENGTH = 8
const SECRET_LENGTH = 32
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export interface GeneratedApiKey {
  /** Full key — shown to user ONCE at creation time, never stored. */
  fullKey: string
  /** `kfk_<prefix-8>` — stored plaintext, used as DB lookup index. */
  keyPrefix: string
  /** SHA-256 hex hash of `fullKey`. Stored in DB; compared with
   *  timingSafeEqual at auth time. */
  keyHash: string
  /** Last 4 chars of `fullKey`. Surfaced in UI as
   *  `kfk_xxxxxxxx…abcd` so users can recognize keys without leaking. */
  keyLast4: string
}

/** Cryptographically secure random base62 string of the given length. */
function randomBase62(length: number): string {
  // Read 2× the needed bytes so we have enough modular slack.
  const bytes = crypto.randomBytes(length * 2)
  let out = ''
  for (let i = 0; i < bytes.length && out.length < length; i += 1) {
    // Drop bytes that would create modulo bias (only use 0..247, which
    // is the largest multiple of 62 ≤ 256).
    const byte = bytes[i]!
    if (byte >= 248) continue
    out += BASE62[byte % 62]
  }
  if (out.length < length) {
    // Pathologically unlikely (would need ~50% of bytes >= 248). Retry.
    return randomBase62(length)
  }
  return out
}

export function generateApiKey(): GeneratedApiKey {
  const prefixBody = randomBase62(PREFIX_LENGTH)
  const secret = randomBase62(SECRET_LENGTH)
  const keyPrefix = `${BRAND_PREFIX}${prefixBody}`
  const fullKey = `${keyPrefix}_${secret}`
  const keyHash = crypto.createHash('sha256').update(fullKey, 'utf8').digest('hex')
  return {
    fullKey,
    keyPrefix,
    keyHash,
    keyLast4: fullKey.slice(-4),
  }
}

/**
 * Constant-time compare a presented key against a stored hash. Used by
 * the public API middleware after the prefix lookup found a candidate
 * row.
 *
 * Why constant-time: prevents timing side-channels that would let an
 * attacker iteratively guess the secret one character at a time.
 */
export function verifyApiKey(presentedKey: string, storedHash: string): boolean {
  const presentedHash = crypto
    .createHash('sha256')
    .update(presentedKey, 'utf8')
    .digest('hex')
  // Both are 64-char hex; timingSafeEqual requires equal length buffers.
  if (presentedHash.length !== storedHash.length) return false
  return crypto.timingSafeEqual(
    Buffer.from(presentedHash, 'hex'),
    Buffer.from(storedHash, 'hex'),
  )
}

/**
 * Pull `kfk_<prefix-8>` out of a full key for DB lookup. Returns null
 * when the input doesn't match the expected shape — caller should treat
 * that as auth failure without ever hitting the DB.
 */
export function parseKeyPrefix(fullKey: string): string | null {
  if (!fullKey.startsWith(BRAND_PREFIX)) return null
  // Expect: kfk_PPPPPPPP_SSSSSSSS...
  const afterBrand = fullKey.slice(BRAND_PREFIX.length)
  const underscoreIdx = afterBrand.indexOf('_')
  if (underscoreIdx !== PREFIX_LENGTH) return null
  const prefix = afterBrand.slice(0, PREFIX_LENGTH)
  if (!/^[A-Za-z0-9]+$/.test(prefix)) return null
  return `${BRAND_PREFIX}${prefix}`
}
