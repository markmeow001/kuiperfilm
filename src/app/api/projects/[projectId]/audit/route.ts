/**
 * Phase 12.5 — GET /api/projects/[projectId]/audit
 *
 * Lists audit log entries for a project, newest first. Cursor pagination
 * (created-at + id) keeps the activity log tab fast even when a project
 * has thousands of entries.
 *
 * Auth: any read access — owner / admin / ws_owner / collaborator / viewer
 * all see the same audit. Transparency is the point.
 *
 * Query params:
 *   limit  default 30, max 100
 *   cursor opaque string from prior page's nextCursor
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const access = await requireProjectAccess(projectId, session.user.id, 'read')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    throw new ApiError('FORBIDDEN', { code: 'NO_PROJECT_ACCESS' })
  }

  const url = new URL(request.url)
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  )
  const cursor = url.searchParams.get('cursor') || null

  const entries = await prisma.auditLog.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
    include: {
      user: {
        select: {
          id: true,
          name: true,
          displayName: true,
        },
      },
    },
  })

  const hasMore = entries.length > limit
  const sliced = hasMore ? entries.slice(0, limit) : entries
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id ?? null : null

  return NextResponse.json({
    entries: sliced.map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      snapshot: e.snapshot,
      createdAt: e.createdAt.toISOString(),
      actor: e.user,
    })),
    nextCursor,
    hasMore,
  })
})
