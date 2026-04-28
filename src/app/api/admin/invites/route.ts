/**
 * Admin: list and create invite codes.
 *
 * GET  /api/admin/invites            — list all invites (newest first)
 * POST /api/admin/invites            — create a new invite
 *   body: { role?, expires_hours?, note? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { createInvite, isValidRole } from '@/lib/admin-service'

export const GET = apiHandler(async () => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const invites = await prisma.inviteCode.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      creator: { select: { id: true, name: true, displayName: true } },
      user: { select: { id: true, name: true, displayName: true } },
    },
  })

  return NextResponse.json({ invites })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const { role, expires_hours, note } = body ?? {}

  if (role !== undefined && role !== null && !isValidRole(role)) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'role must be admin / editor / member',
    })
  }
  if (
    expires_hours !== undefined &&
    expires_hours !== null &&
    (typeof expires_hours !== 'number' || expires_hours <= 0 || expires_hours > 8760)
  ) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'expires_hours must be 1..8760',
    })
  }

  const invite = await createInvite({
    role: role ?? 'member',
    expiresHours: typeof expires_hours === 'number' ? expires_hours : null,
    note: typeof note === 'string' ? note : null,
    createdBy: authResult.session.user.id,
  })

  return NextResponse.json({ invite }, { status: 201 })
})
