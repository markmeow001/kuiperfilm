/**
 * /api/workspaces/[workspaceId]/members/[userId]
 *
 *   PATCH   change member's workspace-scoped role (owner | admin) —
 *           body: { role: 'editor' | 'viewer' }
 *           Phase 12.5 (2026-05-22) — workspace-scoped role
 *   DELETE  remove member (owner | admin) — member can NOT self-leave per spec
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; userId: string }> },
) => {
  const { workspaceId, userId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const [ws, requester] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerEditorId: true },
    }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } }),
  ])
  if (!ws) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_NOT_FOUND' })

  const isAdmin = roleAtLeast(requester?.role, 'admin')
  const isOwner = ws.ownerEditorId === session.user.id
  if (!isAdmin && !isOwner) {
    throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_OWNER' })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const role = body.role === 'viewer' ? 'viewer' : body.role === 'editor' ? 'editor' : null
  if (!role) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ROLE',
      details: { reason: "role must be 'editor' or 'viewer'" },
    })
  }

  // Ensure member exists
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (!member) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_MEMBER_NOT_FOUND' })

  const updated = await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId, userId } },
    data: { role },
  })

  return NextResponse.json({
    success: true,
    workspaceId,
    userId,
    role: updated.role,
  })
})

export const DELETE = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string; userId: string }> },
) => {
  const { workspaceId, userId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const [ws, requester] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerEditorId: true },
    }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } }),
  ])
  if (!ws) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_NOT_FOUND' })

  const isAdmin = roleAtLeast(requester?.role, 'admin')
  const isOwner = ws.ownerEditorId === session.user.id
  if (!isAdmin && !isOwner) {
    // Per spec: "member 不能離開工作區" — member self-leave forbidden,
    // only owner/admin can remove. Same handler enforces both.
    throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_OWNER' })
  }

  // Ensure member exists before delete so 404 vs 200 carries information.
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (!member) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_MEMBER_NOT_FOUND' })

  await prisma.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  return NextResponse.json({ success: true })
})
