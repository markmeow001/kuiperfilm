/**
 * /api/workspaces/[workspaceId]/usage — editor's per-member stats
 *
 * Returns one row per member of the workspace with windowed totals.
 * Owner editor (or admin) only — same gate as the projects view.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getMultiUserUsageStats } from '@/lib/usage/usage-stats'

export const GET = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) => {
  const { workspaceId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const [ws, requester] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, ownerEditorId: true },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    }),
  ])
  if (!ws) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_NOT_FOUND' })

  const isAdmin = roleAtLeast(requester?.role, 'admin')
  const isOwner = ws.ownerEditorId === session.user.id
  if (!isAdmin && !isOwner) {
    throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_OWNER' })
  }

  const memberRows = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: {
      userId: true,
      user: { select: { name: true, displayName: true, role: true } },
    },
  })
  const memberIds = memberRows.map((m) => m.userId)
  const stats = await getMultiUserUsageStats(memberIds)

  return NextResponse.json({
    workspaceId: ws.id,
    workspaceName: ws.name,
    members: memberRows.map((m) => ({
      userId: m.userId,
      userName: m.user.name,
      displayName: m.user.displayName,
      role: m.user.role,
      windows: stats.get(m.userId) || {
        today: { total: 0, video: 0, image: 0, analyze: 0, voice: 0, other: 0 },
        last7d: { total: 0, video: 0, image: 0, analyze: 0, voice: 0, other: 0 },
        last30d: { total: 0, video: 0, image: 0, analyze: 0, voice: 0, other: 0 },
        allTime: { total: 0, video: 0, image: 0, analyze: 0, voice: 0, other: 0 },
      },
    })),
  })
})
