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
import { recordAudit } from '@/lib/audit-log'

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
      // Global app-level role (admin/editor/member) — kept for the existing
      // "role pill" UI that shows what kind of user this is.
      role: m.user.role,
      // Phase 12.5 (2026-05-22) — workspace-scoped role (editor/viewer).
      // Drives WorkspaceDetailDrawer's per-member role toggle and the
      // requireProjectAccess cascade. Existing rows backfilled to 'editor'
      // (preserve RW); new invites land as 'viewer' per Decision 1B.
      workspaceRole: m.role,
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
  // workspaceId in audit goes to projectId=null since this is a
  // workspace-level (not project-level) action.
  await recordAudit(prisma, {
    userId: session.user.id,
    projectId: null,
    action: 'workspace_member.add',
    entityType: 'WorkspaceMember',
    entityId: `${workspaceId}:${userId}`,
    snapshot: { workspaceId, addedUserId: userId },
  })
  return NextResponse.json({
    member: {
      userId: member.userId,
      userName: member.user.name,
      displayName: member.user.displayName,
      role: member.user.role,
      workspaceRole: member.role,
      addedBy: member.addedBy,
      joinedAt: member.joinedAt,
    },
  }, { status: 201 })
})
