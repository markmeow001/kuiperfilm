/**
 * Public API key validator — Phase 5 (2026-05-25).
 *
 * Pipeline (called once per inbound `/api/public/v1/*` request):
 *   1. Pull Bearer token from `Authorization` header
 *   2. Parse the `kfk_<prefix>` segment (rejects malformed input
 *      without ever touching the DB — fast fail path)
 *   3. SELECT one row by keyPrefix (indexed) + workspace join
 *   4. Constant-time SHA-256 hash compare
 *   5. Check revokedAt / expiresAt
 *   6. Return resolved context: workspaceId, scopes, key id, owner
 *
 * Every failure path returns the SAME shape (`{ ok: false, code, status }`)
 * so the caller can render a consistent error envelope without leaking
 * which step failed (prevents user enumeration via response timing /
 * message differences).
 *
 * The validator does NOT do rate-limiting or scope check — those are
 * separate helpers, deliberately called by the API middleware after
 * a successful validate(). This keeps the auth layer focused on
 * "is this key real and active?".
 */

import { prisma } from '@/lib/prisma'
import { logWarn as _ulogWarn } from '@/lib/logging/core'
import { parseKeyPrefix, verifyApiKey } from './generator'
import type { PublicApiScope } from './scopes'

export type ValidationFailure =
  | { ok: false; code: 'MISSING_AUTH_HEADER'; status: 401 }
  | { ok: false; code: 'INVALID_KEY_FORMAT'; status: 401 }
  | { ok: false; code: 'KEY_NOT_FOUND'; status: 401 }
  | { ok: false; code: 'KEY_REVOKED'; status: 401 }
  | { ok: false; code: 'KEY_EXPIRED'; status: 401 }

export interface ValidatedApiKey {
  ok: true
  apiKeyId: string
  workspaceId: string
  scopes: PublicApiScope[]
  reqPerMinute: number
  monthlyCredit: number | null
  createdById: string
  keyLast4: string
}

export type ValidationResult = ValidatedApiKey | ValidationFailure

/**
 * Strip `Bearer ` prefix tolerantly:
 *   - exact `Bearer ` match (RFC 6750 spec)
 *   - case-insensitive `bearer ` (browsers sometimes lowercase)
 *   - bare key (some CLI clients omit the scheme)
 *
 * Returns null when the header is missing or empty.
 */
function extractBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null
  const trimmed = headerValue.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^Bearer\s+(.+)$/i)
  if (match && match[1]) return match[1].trim()
  // Bare-key fallback — only accept if it looks like our key shape.
  if (trimmed.startsWith('kfk_')) return trimmed
  return null
}

/**
 * Validate a Bearer token from an inbound request.
 *
 * `authHeader` is typically `request.headers.get('authorization')`.
 */
export async function validateApiKey(authHeader: string | null | undefined): Promise<ValidationResult> {
  const token = extractBearerToken(authHeader)
  if (!token) {
    return { ok: false, code: 'MISSING_AUTH_HEADER', status: 401 }
  }

  const keyPrefix = parseKeyPrefix(token)
  if (!keyPrefix) {
    return { ok: false, code: 'INVALID_KEY_FORMAT', status: 401 }
  }

  // Single indexed lookup on keyPrefix. Workspace soft-delete isn't
  // modeled today (Workspace has no deletedAt column) — when it lands,
  // add a workspace select + check here.
  const row = await prisma.apiKey.findUnique({
    where: { keyPrefix },
    select: {
      id: true,
      keyHash: true,
      scopes: true,
      reqPerMinute: true,
      monthlyCredit: true,
      revokedAt: true,
      expiresAt: true,
      workspaceId: true,
      createdById: true,
      keyLast4: true,
    },
  })

  if (!row) {
    // Don't leak whether it was a bad prefix vs bad secret — both go
    // through the same KEY_NOT_FOUND path.
    return { ok: false, code: 'KEY_NOT_FOUND', status: 401 }
  }

  if (!verifyApiKey(token, row.keyHash)) {
    _ulogWarn('[api-key] hash mismatch on existing prefix', { keyPrefix })
    return { ok: false, code: 'KEY_NOT_FOUND', status: 401 }
  }

  if (row.revokedAt) {
    return { ok: false, code: 'KEY_REVOKED', status: 401 }
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'KEY_EXPIRED', status: 401 }
  }

  // Parse scope JSON. Stored as JSON text in MySQL for portability.
  let scopes: PublicApiScope[] = []
  try {
    const parsed = JSON.parse(row.scopes)
    if (Array.isArray(parsed)) {
      scopes = parsed.filter((s): s is PublicApiScope => typeof s === 'string')
    }
  } catch {
    // Malformed scope JSON = treat as zero-scope key. Caller will hit
    // INSUFFICIENT_SCOPE on the next check. Log it for ops.
    _ulogWarn('[api-key] malformed scope JSON', { apiKeyId: row.id })
  }

  return {
    ok: true,
    apiKeyId: row.id,
    workspaceId: row.workspaceId,
    scopes,
    reqPerMinute: row.reqPerMinute,
    monthlyCredit: row.monthlyCredit,
    createdById: row.createdById,
    keyLast4: row.keyLast4,
  }
}

/**
 * Best-effort `lastUsedAt` bump. Fire-and-forget so we don't add latency
 * to the request. Errors are swallowed because a stale `lastUsedAt` is
 * a UI inconvenience, not an auth failure.
 *
 * Throttling note: in v1 we bump on every request. If write load becomes
 * a problem, switch to a sampled bump (e.g. 1-in-10) or a Redis-backed
 * coalescer that flushes every N seconds.
 */
export function touchLastUsedAt(apiKeyId: string): void {
  void prisma.apiKey
    .update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } })
    .catch(() => {
      // Intentionally silent — see fn doc.
    })
}
