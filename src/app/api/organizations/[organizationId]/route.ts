/**
 * /api/organizations/[organizationId]
 *
 *   GET     read details (owner | member-via-workspace | admin)
 *   PATCH   rename / update description (owner | admin)
 *   DELETE  cascade workspaces + members (owner | admin)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { UserRole } from '@/lib/auth/user-role'

async function requireOrgAccess(orgId: string, userId: string, mode: 'read' | 'write') {
  const [org, requester] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      include: { _count: { select: { workspaces: true } } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])
  if (!org) throw new ApiError('NOT_FOUND', { code: 'ORGANIZATION_NOT_FOUND' })
  const isAdmin = roleAtLeast(requester?.role, 'admin')
  const isOwner = org.ownerUserId === userId
  if (isAdmin || isOwner) return { org, requester, role: isAdmin ? 'admin' : 'owner' as const }
  if (mode === 'write') {
    throw new ApiError('FORBIDDEN', { code: 'NOT_ORG_OWNER' })
  }
  // read mode: also allow members of any workspace under this org
  const member = await prisma.workspaceMember.findFirst({
    where: {
      userId,
      workspace: { organizationId: orgId },
    },
    select: { workspaceId: true },
  })
  if (!member) throw new ApiError('FORBIDDEN', { code: 'NOT_ORG_MEMBER' })
  return { org, requester, role: UserRole.MEMBER }
}

export const GET = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ organizationId: string }> },
) => {
  const { organizationId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { org } = await requireOrgAccess(organizationId, session.user.id, 'read')
  return NextResponse.json({ organization: org })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ organizationId: string }> },
) => {
  const { organizationId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await requireOrgAccess(organizationId, session.user.id, 'write')

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
  // Admin-only: transfer org ownership to another user. New owner can
  // be admin or editor (role lookup defends against re-assigning to
  // a member who would then be unable to manage the org).
  if (body.ownerUserId !== undefined) {
    const requesterRow = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })
    if (!roleAtLeast(requesterRow?.role, 'admin')) {
      throw new ApiError('FORBIDDEN', {
        code: 'TRANSFER_REQUIRES_ADMIN',
        details: { reason: 'Only admin can change organization.ownerUserId' },
      })
    }
    if (typeof body.ownerUserId !== 'string' || !body.ownerUserId.trim()) {
      throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field: 'ownerUserId' })
    }
    const newOwner = await prisma.user.findUnique({
      where: { id: body.ownerUserId.trim() },
      select: { role: true },
    })
    if (!newOwner) throw new ApiError('NOT_FOUND', { code: 'NEW_OWNER_NOT_FOUND' })
    if (!roleAtLeast(newOwner.role, 'editor')) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'NEW_OWNER_INSUFFICIENT_ROLE',
        details: { required: 'admin | editor', got: newOwner.role },
      })
    }
    data.ownerUserId = body.ownerUserId.trim()
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError('INVALID_PARAMS', { code: 'NO_UPDATABLE_FIELDS' })
  }

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data,
  })
  return NextResponse.json({ organization: updated })
})

export const DELETE = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ organizationId: string }> },
) => {
  const { organizationId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await requireOrgAccess(organizationId, session.user.id, 'write')
  // CASCADE in schema deletes workspaces + workspace_members.
  // Member's projects (Project.userId) untouched — those are user-owned
  // and persist beyond org lifecycle.
  await prisma.organization.delete({ where: { id: organizationId } })
  return NextResponse.json({ success: true })
})
