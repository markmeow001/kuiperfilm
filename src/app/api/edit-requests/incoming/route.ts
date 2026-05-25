/**
 * Phase 12.5 — /api/edit-requests/incoming
 *
 *   GET   list pending edit requests on projects the caller owns
 *         OR can manage as admin.
 *
 * "Owns" means project.userId === requesterId. Admin sees all pending.
 * Workspace owners / collaborator-editors do NOT see incoming requests
 * for projects they don't own — per spec, only the project owner can
 * approve/deny grants. Admin is the global override.
 *
 * Defense-in-depth filter: only return requests with
 *   status='pending' AND createdAt > now - 7d
 * Even if the Day-4 cron hasn't run yet, we never show expired requests.
 *
 * Used by the bell notification dropdown + the standalone incoming
 * requests view (if we add one). Single endpoint serves both.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export const GET = apiHandler(async (
  _request: NextRequest,
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const requester = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  const isAdmin = roleAtLeast(requester?.role, 'admin')

  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS)

  // Admin: see all pending across the system.
  // Non-admin: only requests on projects they own (project.userId === me).
  const whereClause = {
    status: 'pending' as const,
    createdAt: { gt: sevenDaysAgo },
    ...(isAdmin
      ? {}
      : { project: { userId: session.user.id } }),
  }

  const requests = await prisma.editRequest.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      requester: {
        select: {
          id: true,
          name: true,
          displayName: true,
          email: true,
        },
      },
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })

  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      project: r.project,
      requester: r.requester,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    })),
  })
})
