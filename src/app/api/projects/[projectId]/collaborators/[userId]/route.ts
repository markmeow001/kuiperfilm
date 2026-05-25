/**
 * Phase 12.5 (2026-05-22) — DELETE /api/projects/:projectId/collaborators/:userId
 *
 * Revokes a per-project grant. Owner or admin only.
 *
 * Idempotent: 404 (no row) is treated as success — caller can fire
 * the request without pre-checking state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  requireUserAuth,
  isErrorResponse,
  roleAtLeast,
} from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; userId: string }> }
) => {
  const { projectId, userId: targetUserId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const [project, requester] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, deletedAt: true },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    }),
  ])
  if (!project || project.deletedAt) throw new ApiError('NOT_FOUND')

  const isOwner = project.userId === session.user.id
  const isAdmin = roleAtLeast(requester?.role, 'admin')
  if (!isOwner && !isAdmin) {
    throw new ApiError('FORBIDDEN', { code: 'ONLY_OWNER_OR_ADMIN_CAN_REVOKE' })
  }

  // Idempotent delete — Prisma throws P2025 if row missing; we catch
  // and treat as success.
  try {
    await prisma.projectCollaborator.delete({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    })
    return NextResponse.json({ success: true, revoked: true })
  } catch (err) {
    // Prisma's known-not-found error
    if ((err as { code?: string })?.code === 'P2025') {
      return NextResponse.json({ success: true, noop: true })
    }
    throw err
  }
})
