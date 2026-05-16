import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { createScopedLogger } from '@/lib/logging/core'

// /cso F1 residual fix (2026-05-16): fail-closed on cross-tenant IDOR.
//
// History:
//   - The endpoint started fully anonymous. /cso F1 (commit efdb4fd)
//     added requireUserAuth to close the public door.
//   - That left a residual: a logged-in user A could still sign a
//     signed URL for user B's COS key if A knew the key string.
//
// Resolution decided 2026-05-16:
//   - No internal callsite uses this endpoint. The active code path
//     for displaying COS-backed media is `/api/cos/sign` (different
//     route, different gating).
//   - Rather than implement a proper key-prefix → projectId → owner
//     chain for an unused endpoint, we fail-closed here and log
//     access attempts. If 30 days of logs show zero traffic, delete
//     the endpoint outright. If traffic appears, look at the prefix
//     histogram in logs and either fix the caller to use /api/cos/sign
//     or add the narrow ownership check the caller needs.
//
// Logged signal: action `cos_image.access_blocked` with userId, the
// 1st segment of the key prefix (everything up to the first dash, no
// IDs / no full key — privacy-safe), and the request's User-Agent.
// Use this to populate the 30-day usage table.

const logger = createScopedLogger({ module: 'api.cos_image' })

function extractKeyPrefixSegment(key: string): string {
  // Keys look like `images/<type>-<id>-<ts>-<rand>.<ext>` or `images/<file>.<ext>`.
  // We only want the high-level type (e.g. `panel-candidate`) for analytics —
  // no UUIDs, no extensions, no full filenames.
  const stripped = key.replace(/^[a-z0-9]+\//, '')
  const firstDashIdx = stripped.indexOf('-')
  if (firstDashIdx === -1) {
    const dotIdx = stripped.indexOf('.')
    return dotIdx === -1 ? stripped.slice(0, 40) : stripped.slice(0, dotIdx).slice(0, 40)
  }
  return stripped.slice(0, firstDashIdx).slice(0, 40)
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')
  if (!key) {
    throw new ApiError('INVALID_PARAMS')
  }

  logger.info({
    action: 'cos_image.access_blocked',
    userId: session.user.id,
    message: 'authenticated request to legacy /api/cos/image fail-closed (F1 residual)',
    details: {
      keyPrefixSegment: extractKeyPrefixSegment(key),
      userAgent: request.headers.get('user-agent') || null,
    },
  })

  // Fail-closed: legacy endpoint with no per-tenant ownership check.
  // If you hit this in production logs, switch the caller to
  // /api/cos/sign (the actively-maintained signing route) instead.
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'legacy endpoint disabled — use /api/cos/sign',
      },
    },
    { status: 403 },
  )
})
