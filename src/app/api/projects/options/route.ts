import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { isAdmin } from '@/lib/auth/user-role'
import { prisma } from '@/lib/prisma'

type EffectiveRole =
  | 'owner'
  | 'admin'
  | 'ws_owner'
  | 'ws_owner_legacy'
  | 'editor'
  | 'viewer'

function readLimit(value: string | null) {
  const parsed = Number.parseInt(value || '100', 10)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id
  const limit = readLimit(request.nextUrl.searchParams.get('limit'))
  const cursor = request.nextUrl.searchParams.get('cursor')?.trim() || undefined

  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  const admin = isAdmin(requester?.role)

  // This endpoint intentionally returns only selector metadata. The existing
  // /api/projects route computes costs and deep episode/panel statistics and
  // is far too expensive for a simple id/name dropdown.
  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      ...(admin ? {} : {
        OR: [
          { userId },
          { collaborators: { some: { userId } } },
          { workspace: { ownerEditorId: userId } },
          { workspace: { members: { some: { userId } } } },
          // Legacy cascade: workspace owners can access projects owned by
          // users who belong to one of their workspaces, but only while the
          // project has not yet been assigned an explicit workspace.
          {
            workspaceId: null,
            user: {
              workspaceMemberships: {
                some: { workspace: { ownerEditorId: userId } },
              },
            },
          },
        ],
      }),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      userId: true,
      workspaceId: true,
      collaborators: {
        where: { userId },
        select: { role: true },
        take: 1,
      },
      workspace: {
        select: {
          ownerEditorId: true,
          members: {
            where: { userId },
            select: { role: true },
            take: 1,
          },
        },
      },
      user: {
        select: {
          workspaceMemberships: {
            where: { workspace: { ownerEditorId: userId } },
            select: { workspaceId: true },
            take: 1,
          },
        },
      },
    },
  })

  const hasMore = projects.length > limit
  const page = hasMore ? projects.slice(0, limit) : projects
  const options = page.map((project) => {
    let effectiveRole: EffectiveRole
    if (project.userId === userId) {
      effectiveRole = 'owner'
    } else if (admin) {
      effectiveRole = 'admin'
    } else if (project.workspace?.ownerEditorId === userId) {
      effectiveRole = 'ws_owner'
    } else if (project.workspaceId === null && project.user.workspaceMemberships.length > 0) {
      effectiveRole = 'ws_owner_legacy'
    } else if (project.collaborators[0]) {
      effectiveRole = project.collaborators[0].role
    } else {
      effectiveRole = project.workspace?.members[0]?.role ?? 'viewer'
    }

    return {
      id: project.id,
      name: project.name,
      workspaceId: project.workspaceId,
      effectiveRole,
      canEdit: effectiveRole !== 'viewer',
    }
  })

  return NextResponse.json({
    projects: options,
    nextCursor: hasMore ? page.at(-1)?.id || null : null,
  })
})
