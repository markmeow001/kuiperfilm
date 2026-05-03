/**
 * GET /api/workspaces/[workspaceId]/addable-users
 *
 * Returns the list of registered users that aren't already in this
 * workspace (plus aren't its owner). Used by the workspace member
 * panel to render a one-click "click to add" picker instead of the
 * earlier type-username-by-hand input. The platform is invite-only
 * with a small (~10-20) team, so leaking the full user list to
 * workspace owners is acceptable per the security-posture memo.
 *
 * Permissions mirror the POST handler: owner of the workspace OR
 * platform admin (editor role). Members can't see the addable list
 * because they can't add anyway.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

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
      select: { id: true, ownerEditorId: true },
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

  // Find every active user, then exclude:
  //   1. the workspace owner (implicit member, can't be added again)
  //   2. existing WorkspaceMember rows
  const [allUsers, existingMembers] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        displayName: true,
        email: true,
        role: true,
        createdAt: true,
      },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true },
    }),
  ])

  const memberIds = new Set(existingMembers.map((m) => m.userId))
  const addable = allUsers
    .filter((u) => u.id !== ws.ownerEditorId && !memberIds.has(u.id))
    .map((u) => ({
      userId: u.id,
      userName: u.name,
      displayName: u.displayName,
      // Only surface email to admin requesters — owners get a less
      // identifying view. Keeps the picker useful for "is this the
      // right person" checks without broadcasting emails platform-wide.
      email: isAdmin ? u.email : null,
      role: u.role,
      createdAt: u.createdAt,
    }))

  return NextResponse.json({
    workspaceId: ws.id,
    addable,
    total: addable.length,
  })
})
