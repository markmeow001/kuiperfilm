/**
 * Phase 2.5 (2026-06-10) — Toggle / uninstall a Skill installation.
 *
 * PATCH /api/skill-installations/[id]
 *   body: { enabled: boolean }
 *   → flip 啟用 / 停用 on an existing installation
 *
 * DELETE /api/skill-installations/[id]
 *   → uninstall + decrement Skill.installCount
 *
 * Auth: installation owner only. Even admin can't toggle someone else's
 * installation — preferences are user-scoped state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id
  const { id } = await context.params

  const body = await request.json().catch(() => ({}))
  const enabled = typeof body?.enabled === 'boolean' ? body.enabled : null
  if (enabled === null) {
    throw new ApiError('INVALID_PARAMS', { message: 'enabled (boolean) required' })
  }

  const existing = await prisma.skillInstallation.findUnique({
    where: { id },
    select: { id: true, userId: true },
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND')
  }
  if (existing.userId !== userId) {
    // Don't reveal the row exists to a non-owner.
    throw new ApiError('NOT_FOUND')
  }

  const updated = await prisma.skillInstallation.update({
    where: { id },
    data: { enabled },
  })

  return NextResponse.json({
    installation: {
      id: updated.id,
      skillId: updated.skillId,
      enabled: updated.enabled,
      installedAt: updated.installedAt,
      lastUsedAt: updated.lastUsedAt,
    },
  })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id
  const { id } = await context.params

  const existing = await prisma.skillInstallation.findUnique({
    where: { id },
    select: { id: true, userId: true, skillId: true },
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND')
  }
  if (existing.userId !== userId) {
    throw new ApiError('NOT_FOUND')
  }

  await prisma.$transaction([
    prisma.skillInstallation.delete({ where: { id } }),
    prisma.skill.update({
      where: { id: existing.skillId },
      data: { installCount: { decrement: 1 } },
    }),
  ])

  return NextResponse.json({ success: true })
})
