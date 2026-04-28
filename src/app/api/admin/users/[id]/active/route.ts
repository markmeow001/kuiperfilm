/**
 * Admin: enable or disable a user account.
 *
 * PATCH /api/admin/users/:id/active  body: { isActive: boolean }
 *
 * Guards:
 * - Acting admin cannot disable themselves
 * - Cannot disable the last active admin
 */
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { assertNotLastActiveAdmin } from '@/lib/admin-service'

export const PATCH = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const authResult = await requireAdminAuth()
    if (isErrorResponse(authResult)) return authResult

    const { id: targetUserId } = await params
    const { session } = authResult

    if (targetUserId === session.user.id) {
      throw new ApiError('FORBIDDEN', {
        message: 'Cannot change your own active status',
        reason: 'self_modification',
      })
    }

    const body = await request.json().catch(() => ({}))
    const isActive = body?.isActive
    if (typeof isActive !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', { message: 'isActive must be boolean' })
    }

    const target = await prisma.user.findUnique({ where: { id: targetUserId } })
    if (!target) {
      throw new ApiError('NOT_FOUND', { message: 'User not found' })
    }

    if (isActive === false) {
      await assertNotLastActiveAdmin(targetUserId)
    }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: { isActive },
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
