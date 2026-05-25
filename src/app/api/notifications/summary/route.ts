/**
 * Phase 12.5 — /api/notifications/summary
 *
 *   GET    single combined endpoint for the bell badge dropdown.
 *          Returns: { incomingRequests, myRequests, adminDeletions }
 *
 * Design decision (spec §9.5 #2): one combined endpoint polled every 30s
 * by the bell instead of 3 separate polls. At 10-20 users this is
 * trivial DB load. SSE/WebSocket would be over-engineering at this
 * scale and adds Caddy reverse_proxy + worker-push complexity.
 *
 * Defense-in-depth: requests filtered to pending AND createdAt > now-7d
 * so the bell never shows stale items even if Day-4 cron hasn't run.
 *
 * Capped at 20 items per section to keep payload small. Dropdown
 * shows the most recent; "see all" can deep-link to a dedicated page
 * (Phase 2).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const SECTION_LIMIT = 20
const ADMIN_DELETION_LOOKBACK_DAYS = 30

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
  const lookbackForDeletions = new Date(
    Date.now() - ADMIN_DELETION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  )

  // Run all three queries in parallel — Prisma uses a single connection
  // and a single pool, so this is just three round-trips, not three
  // sessions.
  const [incomingRequests, myRequests, adminDeletions] = await Promise.all([
    // 1. Incoming requests on projects I own (admin sees all)
    prisma.editRequest.findMany({
      where: {
        status: 'pending',
        createdAt: { gt: sevenDaysAgo },
        ...(isAdmin
          ? {}
          : { project: { userId: session.user.id } }),
      },
      orderBy: { createdAt: 'desc' },
      take: SECTION_LIMIT,
      include: {
        requester: {
          select: { id: true, name: true, displayName: true },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    }),

    // 2. My requests (so I can see the status of what I asked for)
    prisma.editRequest.findMany({
      where: {
        requesterId: session.user.id,
        // Include both pending AND recently resolved so user sees
        // "你的請求已被批准" notifications. resolvedAt > now-7d
        // captures recent decisions; pending always shown.
        OR: [
          { status: 'pending', createdAt: { gt: sevenDaysAgo } },
          { status: { in: ['approved', 'denied'] }, resolvedAt: { gt: sevenDaysAgo } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: SECTION_LIMIT,
      include: {
        project: {
          select: { id: true, name: true },
        },
      },
    }),

    // 3. Admin actions on my projects (deletions within restore window).
    // Soft-delete sets deletedAt + deletedBy. Show projects where
    // I'm the owner AND deleted by someone else, within the 30d window.
    prisma.project.findMany({
      where: {
        userId: session.user.id,
        deletedAt: { not: null, gt: lookbackForDeletions },
        deletedBy: { not: session.user.id },
      },
      orderBy: { deletedAt: 'desc' },
      take: SECTION_LIMIT,
      select: {
        id: true,
        name: true,
        deletedAt: true,
        deletedBy: true,
      },
    }),
  ])

  // Pending count drives the badge number — admin notifications don't
  // count toward "you have N things to action" since they're informational.
  // Cap at 99 in the badge UI side (returned raw here).
  const incomingPendingCount = incomingRequests.filter((r) => r.status === 'pending').length

  return NextResponse.json({
    badgeCount: incomingPendingCount,
    incomingRequests: incomingRequests.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      project: r.project,
      requester: r.requester,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    })),
    myRequests: myRequests.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      project: r.project,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    })),
    adminDeletions: adminDeletions.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      deletedAt: p.deletedAt?.toISOString() ?? null,
      deletedBy: p.deletedBy,
    })),
  })
})
