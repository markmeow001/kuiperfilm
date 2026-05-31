/**
 * /api/workspaces/[workspaceId]
 *
 *   GET     read (owner | member | admin)
 *   PATCH   rename (owner | admin)
 *   DELETE  cascade members (owner | admin)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { UserRole } from '@/lib/auth/user-role'

async function requireWorkspaceAccess(workspaceId: string, userId: string, mode: 'read' | 'write') {
  const [ws, requester] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { members: true } },
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])
  if (!ws) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_NOT_FOUND' })
  const isAdmin = roleAtLeast(requester?.role, 'admin')
  const isOwner = ws.ownerEditorId === userId
  if (isAdmin || isOwner) return { ws, requester, role: isAdmin ? 'admin' : 'owner' as const }
  if (mode === 'write') {
    throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_OWNER' })
  }
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (!member) throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_MEMBER' })
  return { ws, requester, role: UserRole.MEMBER }
}

export const GET = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) => {
  const { workspaceId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { ws } = await requireWorkspaceAccess(workspaceId, session.user.id, 'read')
  return NextResponse.json({ workspace: ws })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) => {
  const { workspaceId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await requireWorkspaceAccess(workspaceId, session.user.id, 'write')

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field: 'name' })
    }
    data.name = body.name.trim().slice(0, 100)
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === 'string'
      ? body.description.trim().slice(0, 2000) || null
      : null
  }
  // Admin-only: transfer workspace ownership to another editor.
  // Per role hierarchy, only admin can reassign — workspace owners
  // wanting to hand off should ask admin. The new owner must already
  // hold editor or admin role; promoting a member happens via the
  // /api/admin/users/[id]/role endpoint first.
  if (body.ownerEditorId !== undefined) {
    const requesterRow = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })
    if (!roleAtLeast(requesterRow?.role, 'admin')) {
      throw new ApiError('FORBIDDEN', {
        code: 'TRANSFER_REQUIRES_ADMIN',
        details: { reason: 'Only admin can change workspace.ownerEditorId' },
      })
    }
    if (typeof body.ownerEditorId !== 'string' || !body.ownerEditorId.trim()) {
      throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field: 'ownerEditorId' })
    }
    const newOwner = await prisma.user.findUnique({
      where: { id: body.ownerEditorId.trim() },
      select: { id: true, isActive: true },
    })
    if (!newOwner) throw new ApiError('NOT_FOUND', { code: 'NEW_OWNER_NOT_FOUND' })
    if (!newOwner.isActive) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'NEW_OWNER_INACTIVE',
        details: { reason: 'Cannot transfer to a deactivated user' },
      })
    }
    // 2026-05-02: dropped the role >= editor check. Phase 1 of the
    // role simplification makes "workspace owner" independent of
    // platform `editor` role — a 組長 is defined by ownership, not
    // by carrying an editor flag. Eventually editor will be removed
    // entirely (Phase 4) and demoted users still keep workspaces
    // they own.
    data.ownerEditorId = body.ownerEditorId.trim()
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError('INVALID_PARAMS', { code: 'NO_UPDATABLE_FIELDS' })
  }
  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data,
  })
  return NextResponse.json({ workspace: updated })
})

export const DELETE = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) => {
  const { workspaceId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await requireWorkspaceAccess(workspaceId, session.user.id, 'write')
  await prisma.workspace.delete({ where: { id: workspaceId } })
  return NextResponse.json({ success: true })
})
