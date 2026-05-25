/**
 * Phase 12.5 (2026-05-22) — /api/projects/[projectId]/collaborators
 *
 * Per-project explicit role grants (Figma "share" model).
 * Overrides WorkspaceMember.role for this specific project only.
 *
 *   GET    list collaborators (any read access)
 *   POST   add / upsert collaborator (owner | admin only)
 *          body: { userId, role: 'editor' | 'viewer' }
 *
 * Per-collaborator DELETE lives at .../collaborators/[userId]/route.ts
 *
 * Auth model:
 *   - GET: passes if requester has read access to the project (cascade)
 *   - POST: owner OR admin only (collaborators can't invite further
 *     collaborators — keeps the grant tree shallow & auditable)
 *
 * Validation:
 *   - userId must be a real, active User
 *   - role ∈ {editor, viewer}
 *   - cannot add the project owner as their own collaborator (no-op)
 *   - cannot add admin user as collaborator (they already have full access)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  requireUserAuth,
  isErrorResponse,
  requireProjectAccess,
  roleAtLeast,
} from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  displayName: true,
  email: true,
  role: true,
} as const

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Anyone with read access can see the collaborator list.
  const access = await requireProjectAccess(projectId, session.user.id, 'read')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    throw new ApiError('FORBIDDEN', { code: 'NO_PROJECT_ACCESS' })
  }

  const collaborators = await prisma.projectCollaborator.findMany({
    where: { projectId },
    orderBy: { grantedAt: 'desc' },
    include: {
      user: { select: PUBLIC_USER_SELECT },
      granter: { select: PUBLIC_USER_SELECT },
    },
  })

  return NextResponse.json({
    projectId,
    collaborators: collaborators.map((c) => ({
      userId: c.userId,
      role: c.role,
      grantedAt: c.grantedAt.toISOString(),
      user: c.user,
      granter: c.granter,
    })),
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // POST gates: owner OR admin only — collaborators can't promote
  // further. Use a lightweight check before the cascade since the
  // cascade returns 'editor' for ws-granted RW which is too permissive
  // for collaborator management.
  const [project, requester] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true, deletedAt: true },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    }),
  ])
  if (!project || project.deletedAt) throw new ApiError('NOT_FOUND')
  const isOwner = project.userId === session.user.id
  const isAdmin = roleAtLeast(requester?.role, 'admin')
  if (!isOwner && !isAdmin) {
    throw new ApiError('FORBIDDEN', { code: 'ONLY_OWNER_OR_ADMIN_CAN_INVITE' })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const role = body.role === 'viewer' ? 'viewer' : body.role === 'editor' ? 'editor' : null
  if (!targetUserId) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field: 'userId' })
  }
  if (!role) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field: 'role' })
  }

  if (targetUserId === project.userId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OWNER_NOT_COLLABORATOR',
      details: { reason: '專案擁有者已有完整權限，無需加為協作者' },
    })
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isActive: true, role: true },
  })
  if (!targetUser || !targetUser.isActive) {
    throw new ApiError('NOT_FOUND', { code: 'USER_NOT_FOUND' })
  }
  if (roleAtLeast(targetUser.role, 'admin')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ADMIN_NOT_COLLABORATOR',
      details: { reason: '系統管理員已有所有專案的全 access，無需加為協作者' },
    })
  }

  const collab = await prisma.projectCollaborator.upsert({
    where: { projectId_userId: { projectId, userId: targetUserId } },
    create: {
      projectId,
      userId: targetUserId,
      role,
      grantedBy: session.user.id,
    },
    update: { role, grantedBy: session.user.id },
    include: {
      user: { select: PUBLIC_USER_SELECT },
      granter: { select: PUBLIC_USER_SELECT },
    },
  })

  return NextResponse.json({
    success: true,
    collaborator: {
      userId: collab.userId,
      role: collab.role,
      grantedAt: collab.grantedAt.toISOString(),
      user: collab.user,
      granter: collab.granter,
    },
  })
})
