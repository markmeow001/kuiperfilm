/**
 * Admin: list all users in the platform.
 *
 * GET /api/admin/users
 */
import { NextResponse } from 'next/server'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export const GET = apiHandler(async () => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
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

  return NextResponse.json({ users })
})
