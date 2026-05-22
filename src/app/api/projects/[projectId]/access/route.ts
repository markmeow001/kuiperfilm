/**
 * Phase 12.5 (2026-05-22) — GET /api/projects/:projectId/access
 *
 * Lightweight introspection endpoint: tells the frontend which role
 * the current user effectively has on this project, and whether they
 * can read / write.
 *
 * Why a separate endpoint: every V2 page needs this info to decide
 * which buttons to disable / which badge to show. Hitting the full
 * project endpoint just to ask "am I a viewer here?" is wasteful.
 *
 * Returns:
 *   {
 *     allowed: true,
 *     role: 'owner' | 'admin' | 'ws_owner' | 'ws_owner_legacy' | 'editor' | 'viewer',
 *     canEdit: boolean,
 *     canView: true,    // always true if allowed
 *   }
 *
 *   or 403 if user has no access at all (frontend treats as full lockout)
 *   or 404 if project doesn't exist / is soft-deleted (frontend hides project)
 *
 * Auth: any authenticated user — the helper itself decides allowed/denied.
 * Cache hint: ETag could be added later if needed; for now React Query
 * staleTime handles the client-side caching.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Run the cascade twice — once for read, once for write — so the
  // response gives the frontend complete capability info in one round
  // trip. The cascade is cheap (≤4 DB lookups for cross-user paths,
  // 0 extra for owner/admin short-circuit), so doubling it is fine.
  const readAccess = await requireProjectAccess(projectId, session.user.id, 'read')
  if (!readAccess.allowed) {
    if (readAccess.reason === 'NOT_FOUND') {
      throw new ApiError('NOT_FOUND')
    }
    if (readAccess.reason === 'NOT_AUTHENTICATED') {
      throw new ApiError('UNAUTHORIZED')
    }
    // NO_ACCESS or VIEWER_CANNOT_WRITE on read shouldn't happen here
    // (read is permissive). Treat as 403.
    throw new ApiError('FORBIDDEN', { code: 'NO_ACCESS' })
  }

  // Same project lookup is cached by Prisma client during this request;
  // the write check above re-uses it. Net: one extra cascade pass.
  const writeAccess = await requireProjectAccess(projectId, session.user.id, 'write')
  const canEdit = writeAccess.allowed

  return NextResponse.json({
    allowed: true,
    role: readAccess.effectiveRole,
    canEdit,
    canView: true,
  })
})
