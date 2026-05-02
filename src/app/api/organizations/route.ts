/**
 * /api/organizations
 *
 * Top-level container in the org → workspace → member hierarchy
 * (2026-05-02). Editor or admin can create. Member sees orgs that
 * contain workspaces they belong to.
 *
 *   POST   /api/organizations             create
 *   GET    /api/organizations             list mine (owned + via workspace membership)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

function readString(value: unknown, field: string, max = 255): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field })
  }
  const trimmed = value.trim()
  if (trimmed.length > max) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  }
  return trimmed
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Only admin or editor may create orgs (members are participants, not
  // owners). Per-spec member is "added by editor", not self-service.
  const requester = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (!requester || (requester.role !== 'admin' && requester.role !== 'editor')) {
    throw new ApiError('FORBIDDEN', {
      code: 'INSUFFICIENT_ROLE',
      details: { required: 'admin | editor' },
    })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const name = readString(body.name, 'name', 100)
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim().slice(0, 2000)
    : null

  const org = await prisma.organization.create({
    data: {
      name,
      description,
      ownerUserId: session.user.id,
    },
  })

  return NextResponse.json({ organization: org }, { status: 201 })
})

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Visible orgs:
  //   1. orgs I own
  //   2. orgs that contain workspaces I'm a member of (transitive)
  // Admin sees everything (multi-user demo override).
  const requester = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })

  if (requester?.role === 'admin') {
    const all = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { workspaces: true } } },
    })
    return NextResponse.json({ organizations: all })
  }

  const owned = await prisma.organization.findMany({
    where: { ownerUserId: session.user.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { workspaces: true } } },
  })

  const viaMembership = await prisma.organization.findMany({
    where: {
      ownerUserId: { not: session.user.id }, // dedupe with `owned`
      workspaces: {
        some: {
          members: { some: { userId: session.user.id } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { workspaces: true } } },
  })

  return NextResponse.json({ organizations: [...owned, ...viaMembership] })
})
