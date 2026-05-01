/**
 * Admin: per-user balance read + credit (top-up).
 *
 * GET    /api/admin/users/:id/balance        → current { balance, frozenAmount, totalSpent }
 * POST   /api/admin/users/:id/balance/credit body { delta: number, note?: string }
 *
 * delta is added to balance — supply negative to debit. Wrapped in a
 * transaction so concurrent admin operations don't double-count. Both
 * endpoints require admin auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

interface BalanceShape {
  balance: string
  frozenAmount: string
  totalSpent: string
}

function serialize(b: { balance: Prisma.Decimal; frozenAmount: Prisma.Decimal; totalSpent: Prisma.Decimal }): BalanceShape {
  return {
    balance: b.balance.toString(),
    frozenAmount: b.frozenAmount.toString(),
    totalSpent: b.totalSpent.toString(),
  }
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const { id } = await context.params

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true },
  })
  if (!target) {
    throw new ApiError('NOT_FOUND', { code: 'USER_NOT_FOUND' })
  }

  const balance = await prisma.userBalance.upsert({
    where: { userId: id },
    create: { userId: id },
    update: {},
  })

  return NextResponse.json({
    user: { id: target.id, name: target.name },
    balance: serialize(balance),
  })
})
