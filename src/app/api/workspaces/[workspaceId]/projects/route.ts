/**
 * /api/workspaces/[workspaceId]/projects
 *
 * Editor's "see all projects from my workspace members" view.
 * Returns every project owned by any member of this workspace.
 *
 *   GET   (owner | admin)  list all projects of all members
 *
 * Member of the workspace gets 403 — this is a managerial view; member's
 * own project list goes through the regular /api/projects route which
 * already filters by userId === session.user.id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (
  request: NextRequest,
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
    prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } }),
  ])
  if (!ws) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_NOT_FOUND' })

  const isAdmin = roleAtLeast(requester?.role, 'admin')
  const isOwner = ws.ownerEditorId === session.user.id
  if (!isAdmin && !isOwner) {
    throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_OWNER' })
  }

  const memberRows = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true },
  })
  const memberIds = memberRows.map((m) => m.userId)
  if (memberIds.length === 0) {
    return NextResponse.json({
      workspaceId: ws.id,
      workspaceName: ws.name,
      members: 0,
      projects: [],
    })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200)
  const cursor = searchParams.get('cursor') || undefined

  // Phase 12.5 (2026-05-22) — exclude soft-deleted from workspace project view.
  // Owner of soft-deleted project gets restore notification; admin can see
  // them via /api/admin/projects?includeDeleted=true.
  const projects = await prisma.project.findMany({
    where: { userId: { in: memberIds }, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      user: { select: { id: true, name: true, displayName: true } },
    },
  })

  const hasMore = projects.length > limit
  const trimmed = hasMore ? projects.slice(0, limit) : projects

  return NextResponse.json({
    workspaceId: ws.id,
    workspaceName: ws.name,
    members: memberIds.length,
    projects: trimmed.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      mode: p.mode,
      ownerUserId: p.userId,
      ownerName: p.user.name,
      ownerDisplayName: p.user.displayName,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
    nextCursor: hasMore ? trimmed[trimmed.length - 1].id : null,
  })
})
