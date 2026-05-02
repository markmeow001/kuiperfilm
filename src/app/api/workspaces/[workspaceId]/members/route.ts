/**
 * /api/workspaces/[workspaceId]/members
 *
 *   GET    list members (owner | member | admin) — anyone in the workspace
 *   POST   add member (owner | admin) — body: { userId } or { userName }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

async function loadWorkspaceWithRole(workspaceId: string, userId: string) {
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
  return { ws, requester, isAdmin, isOwner }
}

export const GET = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) => {
  const { workspaceId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { ws, isAdmin, isOwner } = await loadWorkspaceWithRole(workspaceId, session.user.id)
  if (!isAdmin && !isOwner) {
    const self = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
    })
    if (!self) throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_MEMBER' })
  }

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: { joinedAt: 'asc' },
    include: {
      user: { select: { id: true, name: true, displayName: true, role: true } },
    },
  })
  return NextResponse.json({
    workspaceId: ws.id,
    members: members.map((m) => ({
      userId: m.userId,
      userName: m.user.name,
      displayName: m.user.displayName,
      role: m.user.role,
      addedBy: m.addedBy,
      joinedAt: m.joinedAt,
    })),
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) => {
  const { workspaceId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { isAdmin, isOwner } = await loadWorkspaceWithRole(workspaceId, session.user.id)
  if (!isAdmin && !isOwner) {
    throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_OWNER' })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  let userId: string | null = null

  if (typeof body.userId === 'string' && body.userId.trim()) {
    userId = body.userId.trim()
  } else if (typeof body.userName === 'string' && body.userName.trim()) {
    const u = await prisma.user.findUnique({
      where: { name: body.userName.trim() },
      select: { id: true },
    })
    if (!u) throw new ApiError('NOT_FOUND', { code: 'USER_NOT_FOUND' })
    userId = u.id
  } else {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIELD_REQUIRED',
      field: 'userId | userName',
    })
  }

  // Reject self-add (owner is implicitly the owner, not a member row)
  // and dedupe existing membership.
  const existing = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (existing) {
    return NextResponse.json({
      member: existing,
      alreadyMember: true,
    })
  }

  const member = await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId,
      addedBy: session.user.id,
    },
    include: {
      user: { select: { id: true, name: true, displayName: true, role: true } },
    },
  })
  return NextResponse.json({
    member: {
      userId: member.userId,
      userName: member.user.name,
      displayName: member.user.displayName,
      role: member.user.role,
      addedBy: member.addedBy,
      joinedAt: member.joinedAt,
    },
  }, { status: 201 })
})
