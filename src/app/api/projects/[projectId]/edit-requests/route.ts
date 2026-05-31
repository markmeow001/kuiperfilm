/**
 * Phase 12.5 — /api/projects/[projectId]/edit-requests
 *
 *   POST   viewer requests edit access on this project
 *          body: { message?: string }
 *          auth: must have read access (any tier)
 *          rules:
 *            - rate limit: ≤5 pending per requester (globally),
 *                          ≤3 pending per (requester, project) pair
 *            - reject if requester is the project owner (no point)
 *            - reject if requester already has write access (no point)
 *            - idempotent: if a pending request already exists for the
 *              same (requester, project), return it instead of creating
 *              a duplicate
 *
 * GET incoming requests lives at /api/edit-requests/incoming/route.ts
 * Approve/deny lives at /api/edit-requests/[requestId]/route.ts
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@/lib/auth/user-role'
import {
  requireUserAuth,
  isErrorResponse,
  requireProjectAccess,
} from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { recordAudit } from '@/lib/audit-log'

const MAX_PENDING_PER_REQUESTER = 5
const MAX_PENDING_PER_PAIR = 3

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Gate: must have read access to even see the project exists.
  // This also covers NOT_FOUND for soft-deleted projects.
  const access = await requireProjectAccess(projectId, session.user.id, 'read')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    throw new ApiError('FORBIDDEN', { code: 'NO_PROJECT_ACCESS' })
  }

  // Reject owner — they already own it. effectiveRole === 'owner' means
  // requireProjectAccess matched the project.userId === requesterId branch.
  if (access.effectiveRole === UserRole.OWNER) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OWNER_CANNOT_REQUEST',
      details: { reason: '你是專案擁有者，無需請求編輯權限' },
    })
  }

  // Reject if already has write access via any tier (admin / ws_owner /
  // ws_owner_legacy / collaborator-editor / ws-member-editor). Easiest way:
  // run the cascade with action='write'.
  const writeAccess = await requireProjectAccess(projectId, session.user.id, 'write')
  if (writeAccess.allowed) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ALREADY_HAS_ACCESS',
      details: {
        reason: '你已經有編輯權限',
        currentRole: writeAccess.effectiveRole,
      },
    })
  }

  // Idempotent: if a pending request already exists for this (requester,
  // project), return it instead of creating a duplicate. Avoids double-
  // submit creating noise in the owner's notification bell.
  const existingPending = await prisma.editRequest.findFirst({
    where: {
      projectId,
      requesterId: session.user.id,
      status: 'pending',
    },
  })
  if (existingPending) {
    return NextResponse.json(
      {
        request: existingPending,
        alreadyPending: true,
      },
      { status: 200 }
    )
  }

  // Rate limit checks. DB-based count queries — composite indexes
  // (@@index([requesterId]), @@index([projectId, status])) keep these cheap.
  const [perRequesterCount, perPairCount] = await Promise.all([
    prisma.editRequest.count({
      where: { requesterId: session.user.id, status: 'pending' },
    }),
    prisma.editRequest.count({
      where: {
        requesterId: session.user.id,
        projectId,
        status: 'pending',
      },
    }),
  ])
  if (perRequesterCount >= MAX_PENDING_PER_REQUESTER) {
    throw new ApiError('RATE_LIMIT', {
      code: 'RATE_LIMIT_REQUESTER',
      details: {
        reason: `你目前有 ${perRequesterCount} 個待處理請求，上限 ${MAX_PENDING_PER_REQUESTER} 個。請等擁有者回覆或撤回部分請求。`,
        limit: MAX_PENDING_PER_REQUESTER,
      },
    })
  }
  if (perPairCount >= MAX_PENDING_PER_PAIR) {
    throw new ApiError('RATE_LIMIT', {
      code: 'RATE_LIMIT_PAIR',
      details: {
        reason: `你對此專案已送出 ${perPairCount} 個請求，上限 ${MAX_PENDING_PER_PAIR} 個。`,
        limit: MAX_PENDING_PER_PAIR,
      },
    })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
  // Cap message length so a malicious payload can't blow up the bell UI.
  const message = rawMessage ? rawMessage.slice(0, 500) : null

  const created = await prisma.editRequest.create({
    data: {
      projectId,
      requesterId: session.user.id,
      message,
      status: 'pending',
    },
  })
  await recordAudit(prisma, {
    userId: session.user.id,
    projectId,
    action: 'edit_request.create',
    entityType: 'EditRequest',
    entityId: created.id,
  })

  return NextResponse.json({ request: created }, { status: 201 })
})
