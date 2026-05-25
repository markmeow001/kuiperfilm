/**
 * Individual API key — revoke.
 *
 *   DELETE /api/workspaces/:workspaceId/api-keys/:keyId
 *
 * Soft delete via `revokedAt = now()`. We keep the row (and its
 * keyHash) so that:
 *   - revoked keys are visibly distinguishable in the UI history
 *   - usage logs continue to FK-link to a real apiKey row
 *   - audit trail of "who created what when" survives
 *
 * The validator already rejects keys with non-null revokedAt, so the
 * revoke takes effect on the very next request without any cache flush.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

async function requireKeyAdminAccess(workspaceId: string, userId: string) {
  const [ws, requester] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerEditorId: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])
  if (!ws) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_NOT_FOUND' })
  const isAdmin = roleAtLeast(requester?.role, 'admin')
  const isOwner = ws.ownerEditorId === userId
  if (!isAdmin && !isOwner) {
    throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_OWNER' })
  }
}

export const DELETE = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string; keyId: string }> },
) => {
  const { workspaceId, keyId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await requireKeyAdminAccess(workspaceId, session.user.id)

  const key = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { id: true, workspaceId: true, revokedAt: true },
  })
  if (!key || key.workspaceId !== workspaceId) {
    throw new ApiError('NOT_FOUND', { code: 'API_KEY_NOT_FOUND' })
  }
  if (key.revokedAt) {
    // Idempotent — re-revoking already-revoked key is a no-op success.
    return NextResponse.json({ ok: true, alreadyRevoked: true })
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
})
