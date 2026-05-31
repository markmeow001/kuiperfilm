/**
 * Admin: change a user's role (admin / editor / member).
 *
 * PATCH /api/admin/users/:id/role  body: { role }
 *
 * Guards:
 * - Acting admin cannot change their own role here
 * - Cannot demote the last active admin
 */
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { UserRole } from '@/lib/auth/user-role'
import { prisma } from '@/lib/prisma'
import { assertNotLastActiveAdmin, isValidRole } from '@/lib/admin-service'

export const PATCH = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const authResult = await requireAdminAuth()
    if (isErrorResponse(authResult)) return authResult

    const { id: targetUserId } = await params
    const { session } = authResult

    if (targetUserId === session.user.id) {
      throw new ApiError('FORBIDDEN', {
        message: 'Cannot change your own role',
        reason: 'self_modification',
      })
    }

    const body = await request.json().catch(() => ({}))
    const role = body?.role
    if (!isValidRole(role)) {
      throw new ApiError('INVALID_PARAMS', {
        message: 'role must be admin / editor / member',
      })
    }

    const target = await prisma.user.findUnique({ where: { id: targetUserId } })
    if (!target) {
      throw new ApiError('NOT_FOUND', { message: 'User not found' })
    }

    // If demoting away from admin, ensure another active admin remains.
    if (target.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
      await assertNotLastActiveAdmin(targetUserId)
    }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: { role },
      select: {
        id: true,
        name: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ user: updated })
  }
)
