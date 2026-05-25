/**
 * Phase 12.5 — /api/edit-requests/[requestId]
 *
 *   PATCH   approve or deny an edit request
 *           body: { action: 'approve' | 'deny' }
 *           auth: project owner OR admin only
 *           idempotent: if already resolved, return current state
 *                       with alreadyResolved: true (no error)
 *           on approve: upsert ProjectCollaborator(projectId, userId, editor)
 *                       in same tx as the EditRequest status update
 *
 *   DELETE  withdraw a request (requester themselves only)
 *           No state change to grants — just marks status='expired'
 *           so it stops appearing in incoming.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { recordAudit } from '@/lib/audit-log'

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) => {
  const { requestId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const action = body.action === 'approve'
    ? 'approve'
    : body.action === 'deny'
      ? 'deny'
      : null
  if (!action) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ACTION',
      details: { reason: "action must be 'approve' or 'deny'" },
    })
  }

  const [editRequest, requester] = await Promise.all([
    prisma.editRequest.findUnique({
      where: { id: requestId },
      include: {
        project: {
          select: { id: true, userId: true, deletedAt: true },
        },
      },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    }),
  ])
  if (!editRequest) throw new ApiError('NOT_FOUND', { code: 'REQUEST_NOT_FOUND' })
  if (!editRequest.project || editRequest.project.deletedAt) {
    throw new ApiError('NOT_FOUND', { code: 'PROJECT_NOT_FOUND' })
  }

  const isOwner = editRequest.project.userId === session.user.id
  const isAdmin = roleAtLeast(requester?.role, 'admin')
  if (!isOwner && !isAdmin) {
    throw new ApiError('FORBIDDEN', { code: 'ONLY_OWNER_OR_ADMIN_CAN_RESOLVE' })
  }

  // Idempotent: if already resolved, return the existing state. Lets the
  // UI safely retry on flaky networks without double-granting.
  if (editRequest.status !== 'pending') {
    return NextResponse.json({
      request: editRequest,
      alreadyResolved: true,
    })
  }

  const resolvedStatus = action === 'approve' ? 'approved' : 'denied'

  // Approve: in a single tx, update the request AND upsert the collaborator.
  // Two scenarios for upsert: (a) no row exists → create as editor;
  // (b) row exists with role=viewer → promote to editor; (c) row exists
  // with role=editor → noop, already what we want.
  const result = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.editRequest.update({
      where: { id: requestId },
      data: {
        status: resolvedStatus,
        resolvedAt: new Date(),
        resolvedBy: session.user.id,
      },
    })

    let collaborator = null
    if (action === 'approve') {
      collaborator = await tx.projectCollaborator.upsert({
        where: {
          projectId_userId: {
            projectId: editRequest.projectId,
            userId: editRequest.requesterId,
          },
        },
        create: {
          projectId: editRequest.projectId,
          userId: editRequest.requesterId,
          role: 'editor',
          grantedBy: session.user.id,
        },
        update: {
          role: 'editor',
          grantedBy: session.user.id,
        },
      })
      // Audit both the request resolution AND the resulting grant.
      // Inside the same tx — atomic with the parent mutation.
      await recordAudit(tx, {
        userId: session.user.id,
        projectId: editRequest.projectId,
        action: 'collaborator.add',
        entityType: 'ProjectCollaborator',
        entityId: collaborator.userId,
      })
    }

    await recordAudit(tx, {
      userId: session.user.id,
      projectId: editRequest.projectId,
      action: action === 'approve' ? 'edit_request.approve' : 'edit_request.deny',
      entityType: 'EditRequest',
      entityId: requestId,
    })

    return { updatedRequest, collaborator }
  })

  return NextResponse.json({
    request: result.updatedRequest,
    collaborator: result.collaborator,
  })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) => {
  const { requestId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const editRequest = await prisma.editRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requesterId: true, status: true },
  })
  if (!editRequest) throw new ApiError('NOT_FOUND', { code: 'REQUEST_NOT_FOUND' })

  // Only the requester themselves can withdraw their own request.
  if (editRequest.requesterId !== session.user.id) {
    throw new ApiError('FORBIDDEN', { code: 'NOT_YOUR_REQUEST' })
  }

  // Idempotent: if already resolved/expired, return success silently.
  if (editRequest.status !== 'pending') {
    return NextResponse.json({ success: true, alreadyResolved: true })
  }

  await prisma.editRequest.update({
    where: { id: requestId },
    data: {
      status: 'expired',
      resolvedAt: new Date(),
      resolvedBy: session.user.id,
    },
  })
  // No projectId is reliably available here without an extra query;
  // pass it from the find above. (Re-query to keep it cheap and obvious.)
  const projectIdForAudit = await prisma.editRequest
    .findUnique({ where: { id: requestId }, select: { projectId: true } })
    .then((r) => r?.projectId ?? null)
  await recordAudit(prisma, {
    userId: session.user.id,
    projectId: projectIdForAudit,
    action: 'edit_request.withdraw',
    entityType: 'EditRequest',
    entityId: requestId,
  })

  return NextResponse.json({ success: true })
})
