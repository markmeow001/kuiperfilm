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
 * Phase 12.5+ enrich: each entry comes back with `targets.{user, workspace,
 * previousWorkspace, requester}` resolved from entity IDs in batch queries.
 * Lets the activity tab show "把專案移到 Team A" instead of "Project#5a92...".
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

interface AuditSnapshot {
  // workspaceId moves
  field?: string
  previousWorkspaceId?: string | null
  newWorkspaceId?: string | null
  // workspace_member.* / collaborator.add via workspace
  workspaceId?: string | null
  addedUserId?: string | null
  removedUserId?: string | null
  targetUserId?: string | null
  previousRole?: string | null
  newRole?: string | null
  // project.soft_delete
  name?: string | null
  ownerId?: string | null
  deletedAt?: string | null
  deletedBy?: string | null
  phase?: string | null
}

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

  // Collect IDs to resolve. Bounded by `limit` (≤100) so this stays cheap.
  const userIds = new Set<string>()
  const wsIds = new Set<string>()
  const reqIds = new Set<string>()
  for (const e of sliced) {
    const snap = (e.snapshot ?? {}) as AuditSnapshot

    if (e.entityType === 'ProjectCollaborator') {
      // entityId IS the collaborator user id
      userIds.add(e.entityId)
    } else if (e.entityType === 'WorkspaceMember') {
      // entityId is `<workspaceId>:<userId>` (see recordAudit call sites)
      const [wsId, uid] = e.entityId.split(':')
      if (wsId) wsIds.add(wsId)
      if (uid) userIds.add(uid)
    } else if (e.entityType === 'EditRequest') {
      reqIds.add(e.entityId)
    }

    if (typeof snap.previousWorkspaceId === 'string') wsIds.add(snap.previousWorkspaceId)
    if (typeof snap.newWorkspaceId === 'string') wsIds.add(snap.newWorkspaceId)
    if (typeof snap.workspaceId === 'string') wsIds.add(snap.workspaceId)
    if (typeof snap.addedUserId === 'string') userIds.add(snap.addedUserId)
    if (typeof snap.removedUserId === 'string') userIds.add(snap.removedUserId)
    if (typeof snap.targetUserId === 'string') userIds.add(snap.targetUserId)
  }

  const [users, workspaces, editRequests] = await Promise.all([
    userIds.size > 0
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, displayName: true },
        })
      : Promise.resolve([]),
    wsIds.size > 0
      ? prisma.workspace.findMany({
          where: { id: { in: [...wsIds] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    reqIds.size > 0
      ? prisma.editRequest.findMany({
          where: { id: { in: [...reqIds] } },
          select: {
            id: true,
            requesterId: true,
            requester: { select: { id: true, name: true, displayName: true } },
          },
        })
      : Promise.resolve([]),
  ])

  const userMap = new Map(users.map((u) => [u.id, u]))
  const wsMap = new Map(workspaces.map((w) => [w.id, w]))
  const reqMap = new Map(editRequests.map((r) => [r.id, r]))

  // Pick the "primary target user" id for an entry based on action / snapshot.
  function resolveTargetUserId(e: typeof sliced[number], snap: AuditSnapshot): string | null {
    if (e.entityType === 'ProjectCollaborator') return e.entityId
    if (e.entityType === 'WorkspaceMember') {
      const [, uid] = e.entityId.split(':')
      return uid || null
    }
    return (
      snap.addedUserId ||
      snap.removedUserId ||
      snap.targetUserId ||
      null
    )
  }

  return NextResponse.json({
    entries: sliced.map((e) => {
      const snap = (e.snapshot ?? {}) as AuditSnapshot
      const targetUserId = resolveTargetUserId(e, snap)
      const targetUser = targetUserId ? userMap.get(targetUserId) ?? null : null
      const previousWorkspace = snap.previousWorkspaceId
        ? wsMap.get(snap.previousWorkspaceId) ?? null
        : null
      const newWorkspace = snap.newWorkspaceId
        ? wsMap.get(snap.newWorkspaceId) ?? null
        : null
      const workspace = snap.workspaceId ? wsMap.get(snap.workspaceId) ?? null : null
      const requester =
        e.entityType === 'EditRequest'
          ? reqMap.get(e.entityId)?.requester ?? null
          : null

      return {
        id: e.id,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        snapshot: e.snapshot,
        createdAt: e.createdAt.toISOString(),
        actor: e.user,
        // Resolved names — frontend renders friendly Chinese with these.
        // Any null means the entity was deleted since the audit was written
        // (forensic trails outlive their subjects); frontend falls back to ID.
        targets: {
          user: targetUser,
          previousWorkspace,
          newWorkspace,
          workspace,
          requester,
        },
      }
    }),
    nextCursor,
    hasMore,
  })
})
