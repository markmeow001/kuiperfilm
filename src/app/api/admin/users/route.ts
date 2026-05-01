/**
 * Admin: list all users in the platform — augmented with each user's
 * credit balance and storage usage so the dashboard can render
 * everything in one table without N+1 fetches.
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

  const [users, balances, storageGrouped] = await Promise.all([
    prisma.user.findMany({
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
    }),
    prisma.userBalance.findMany({
      select: { userId: true, balance: true, frozenAmount: true, totalSpent: true },
    }),
    prisma.mediaObject.groupBy({
      by: ['uploadedByUserId'],
      _sum: { sizeBytes: true },
      _count: { id: true },
    }),
  ])

  const balanceMap = new Map(balances.map((b) => [b.userId, b]))
  const storageMap = new Map(
    storageGrouped
      .filter((g): g is typeof g & { uploadedByUserId: string } => Boolean(g.uploadedByUserId))
      .map((g) => [
        g.uploadedByUserId,
        {
          bytes: (g._sum.sizeBytes ?? BigInt(0)).toString(),
          objectCount: g._count.id,
        },
      ]),
  )

  const augmented = users.map((u) => {
    const b = balanceMap.get(u.id)
    const s = storageMap.get(u.id)
    return {
      ...u,
      balance: b
        ? {
            balance: b.balance.toString(),
            frozenAmount: b.frozenAmount.toString(),
            totalSpent: b.totalSpent.toString(),
          }
        : null,
      storage: s ?? { bytes: '0', objectCount: 0 },
    }
  })

  return NextResponse.json({ users: augmented })
})
