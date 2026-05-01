/**
 * Admin: top up (or debit) a user's credit balance.
 *
 * POST /api/admin/users/:id/balance/credit
 * body: { delta: number, note?: string }
 *
 * delta is added to balance — supply negative to debit (e.g. claw back
 * a refund). Wrapped in a transaction with select-for-update semantics
 * so two admins clicking 補值 simultaneously don't lose updates.
 *
 * Note is recorded on a BalanceFreeze entry with status='admin-credit'
 * for audit trail (we don't have a dedicated admin-actions table yet —
 * Phase 11.x.x backlog).
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

const MAX_DELTA = 1_000_000 // safety cap so a typo doesn't credit a million

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { id } = await context.params

  const body = await request.json().catch(() => ({}))
  const deltaRaw = (body as { delta?: unknown }).delta
  const note = typeof (body as { note?: unknown }).note === 'string'
    ? (body as { note: string }).note.trim().slice(0, 200)
    : null

  if (typeof deltaRaw !== 'number' || !Number.isFinite(deltaRaw)) {
    throw new ApiError('INVALID_PARAMS', { code: 'DELTA_REQUIRED', message: 'delta must be a finite number' })
  }
  if (Math.abs(deltaRaw) > MAX_DELTA) {
    throw new ApiError('INVALID_PARAMS', { code: 'DELTA_TOO_LARGE', message: `|delta| must be <= ${MAX_DELTA}` })
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true },
  })
  if (!target) {
    throw new ApiError('NOT_FOUND', { code: 'USER_NOT_FOUND' })
  }

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.userBalance.upsert({
      where: { userId: id },
      create: { userId: id },
      update: {},
    })
    const next = current.balance.add(new Prisma.Decimal(deltaRaw))
    if (next.lessThan(0)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'BALANCE_NEGATIVE',
        message: `debit would leave balance ${next.toString()} (currently ${current.balance.toString()})`,
      })
    }
    const after = await tx.userBalance.update({
      where: { userId: id },
      data: { balance: next },
    })
    // Audit row on BalanceFreeze (existing table; status distinguishes)
    await tx.balanceFreeze.create({
      data: {
        userId: id,
        amount: new Prisma.Decimal(deltaRaw),
        status: deltaRaw >= 0 ? 'admin-credit' : 'admin-debit',
        source: `admin:${session.user.id}`,
        metadata: JSON.stringify({ note, by: session.user.name ?? session.user.id }),
      },
    })
    return after
  })

  return NextResponse.json({
    user: { id: target.id, name: target.name },
    balance: {
      balance: updated.balance.toString(),
      frozenAmount: updated.frozenAmount.toString(),
      totalSpent: updated.totalSpent.toString(),
    },
    delta: deltaRaw,
  })
})
