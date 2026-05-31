/**
 * Phase 12.5 (2026-05-22) — POST /api/projects/:projectId/restore
 *
 * Restore a soft-deleted project within the 30-day grace window.
 *
 * Auth:
 *   - Project owner (project.userId === requester) OR admin can restore.
 *   - Workspace owner editors and collaborators CANNOT restore — only
 *     the original owner gets the recovery action, plus sys admin as
 *     escape hatch.
 *
 * Window:
 *   - deletedAt + 30 days. After that, the daily cron job hard-deletes
 *     the row + COS files. Restore returns 410 GONE if past window.
 *
 * Idempotency:
 *   - Restoring an already-restored (deletedAt IS NULL) project returns
 *     200 with `noop: true`. Lets the UI fire the request without
 *     pre-checking state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { isAdmin as _isAdmin } from '@/lib/auth/user-role'
import { logProjectAction } from '@/lib/logging/semantic'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { recordAudit } from '@/lib/audit-log'

const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session

  // Bypass requireProjectAccess here because that helper short-circuits
  // soft-deleted projects to NOT_FOUND. We need the row deletedAt info.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      userId: true,
      name: true,
      deletedAt: true,
      deletedBy: true,
    },
  })
  if (!project) throw new ApiError('NOT_FOUND')

  // Idempotency: not deleted → no-op success
  if (!project.deletedAt) {
    return NextResponse.json({ success: true, noop: true, message: '此項目未被刪除' })
  }

  // Auth: owner OR admin only
  const isOwner = project.userId === session.user.id
  let isAdmin = false
  if (!isOwner) {
    const requester = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })
    isAdmin = _isAdmin(requester?.role)
  }
  if (!isOwner && !isAdmin) {
    throw new ApiError('FORBIDDEN', {
      code: 'RESTORE_REQUIRES_OWNER_OR_ADMIN',
      details: { reason: '只有專案擁有者或系統管理員可恢復' },
    })
  }

  // Window check: must be within 30 days of deletion.
  // ApiError spec doesn't carry a 410 GONE code, so use NOT_FOUND with
  // an explicit details payload — semantically "this resource is past
  // the recovery point" reads close enough to "not found" for clients.
  const deletedAtMs = project.deletedAt.getTime()
  const windowEndMs = deletedAtMs + RESTORE_WINDOW_MS
  if (Date.now() > windowEndMs) {
    throw new ApiError('NOT_FOUND', {
      code: 'RESTORE_WINDOW_EXPIRED',
      details: {
        deletedAt: project.deletedAt.toISOString(),
        windowExpiredAt: new Date(windowEndMs).toISOString(),
        reason: '專案已超過 30 天恢復期，無法恢復',
      },
    })
  }

  // Restore: clear deletedAt + deletedBy
  await prisma.project.update({
    where: { id: projectId },
    data: {
      deletedAt: null,
      deletedBy: null,
    },
  })

  logProjectAction(
    'RESTORE',
    session.user.id,
    session.user.name,
    projectId,
    project.name,
    {
      previousDeletedAt: project.deletedAt.toISOString(),
      previousDeletedBy: project.deletedBy,
      restoredBy: session.user.id,
      restoredByRole: isAdmin ? 'admin' : 'owner',
    }
  )

  await recordAudit(prisma, {
    userId: session.user.id,
    projectId,
    action: 'project.restore',
    entityType: 'Project',
    entityId: projectId,
    snapshot: {
      previousDeletedAt: project.deletedAt.toISOString(),
      previousDeletedBy: project.deletedBy,
    },
  })

  _ulogInfo(`[RESTORE] 项目已恢复: ${project.name} (${projectId}) by ${session.user.id}`)

  return NextResponse.json({
    success: true,
    restored: true,
    projectId,
    projectName: project.name,
  })
})
