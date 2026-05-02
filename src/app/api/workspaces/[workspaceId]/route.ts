/**
 * /api/workspaces/[workspaceId]
 *
 *   GET     read (owner | member | admin)
 *   PATCH   rename (owner | admin)
 *   DELETE  cascade members (owner | admin)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

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
  const isAdmin = requester?.role === 'admin'
  const isOwner = ws.ownerEditorId === userId
  if (isAdmin || isOwner) return { ws, requester, role: isAdmin ? 'admin' : 'owner' as const }
  if (mode === 'write') {
    throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_OWNER' })
  }
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (!member) throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_MEMBER' })
  return { ws, requester, role: 'member' as const }
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
