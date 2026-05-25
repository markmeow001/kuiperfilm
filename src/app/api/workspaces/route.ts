/**
 * /api/workspaces
 *
 *   POST   create (editor inside their org, or admin)
 *   GET    list mine — workspaces I own (editor) + workspaces I'm member of
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Hierarchy admin > editor > member: admin auto-covers editor here.
  const requester = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (!roleAtLeast(requester?.role, 'editor')) {
    throw new ApiError('FORBIDDEN', {
      code: 'INSUFFICIENT_ROLE',
      details: { required: 'admin | editor' },
    })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  if (typeof body.name !== 'string' || !body.name.trim()) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field: 'name' })
  }
  if (typeof body.organizationId !== 'string' || !body.organizationId.trim()) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field: 'organizationId' })
  }

  const name = body.name.trim().slice(0, 100)
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim().slice(0, 2000)
    : null
  const organizationId = body.organizationId.trim()

  // Verify the org exists and the requester can write to it (org owner
  // or admin). Otherwise an editor could create workspaces inside any
  // arbitrary org id.
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, ownerUserId: true },
  })
  if (!org) throw new ApiError('NOT_FOUND', { code: 'ORGANIZATION_NOT_FOUND' })
  // admin bypasses org-owner check; mirrors org access pattern across
  // workspace/member/projects routes.
  if (!roleAtLeast(requester?.role, 'admin') && org.ownerUserId !== session.user.id) {
    throw new ApiError('FORBIDDEN', { code: 'NOT_ORG_OWNER' })
  }

  // 2026-05-02 — admin can specify `ownerEditorId` to assign the
  // workspace to a specific 組長 directly at creation time. Without
  // this admin had to create-then-PATCH-transfer, two API calls and
  // two cache invalidations. Default behaviour preserved for
  // non-admin: requester becomes the owner.
  let ownerEditorId = session.user.id
  if (typeof body.ownerEditorId === 'string' && body.ownerEditorId.trim()) {
    if (!roleAtLeast(requester?.role, 'admin')) {
      throw new ApiError('FORBIDDEN', {
        code: 'OWNER_ASSIGN_REQUIRES_ADMIN',
        details: { reason: 'Only admin can assign workspace to another user at creation' },
      })
    }
    const targetOwner = await prisma.user.findUnique({
      where: { id: body.ownerEditorId.trim() },
      select: { id: true, isActive: true },
    })
    if (!targetOwner || !targetOwner.isActive) {
      throw new ApiError('NOT_FOUND', { code: 'OWNER_NOT_FOUND' })
    }
    // Member is allowed as owner. Phase 1 of the role simplification
    // makes ownership independent of platform `editor` role — a 組長
    // is "the owner of a workspace", not "a user with editor role".
    ownerEditorId = targetOwner.id
  }

  const ws = await prisma.workspace.create({
    data: {
      name,
      description,
      organizationId,
      ownerEditorId,
    },
  })
  return NextResponse.json({ workspace: ws }, { status: 201 })
})

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const requester = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })

  if (roleAtLeast(requester?.role, 'admin')) {
    const all = await prisma.workspace.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true } },
        _count: {
          select: {
            members: true,
            // Exclude soft-deleted so the dropdown count matches what
            // /api/projects?ws= actually returns.
            projects: { where: { deletedAt: null } },
          },
        },
      },
    })
    return NextResponse.json({ workspaces: all })
  }

  const owned = await prisma.workspace.findMany({
    where: { ownerEditorId: session.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      organization: { select: { id: true, name: true } },
      _count: { select: { members: true } },
    },
  })
  const memberOf = await prisma.workspace.findMany({
    where: {
      ownerEditorId: { not: session.user.id }, // dedupe
      members: { some: { userId: session.user.id } },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      organization: { select: { id: true, name: true } },
      _count: { select: { members: true } },
    },
  })
  return NextResponse.json({
    workspaces: owned,
    workspaceMemberships: memberOf,
  })
})
