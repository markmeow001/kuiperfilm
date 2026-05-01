/**
 * Admin: storage byte usage aggregated per user.
 *
 * GET /api/admin/storage-stats
 *
 * Sums MediaObject.sizeBytes by uploadedByUserId. R2 / COS bills by
 * stored bytes so this is the field to watch for cost spikes. Rows
 * with NULL uploadedByUserId (legacy uploads pre-Q-005) bucket
 * under userId='__unknown__'.
 */
import { NextResponse } from 'next/server'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export const GET = apiHandler(async () => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const grouped = await prisma.mediaObject.groupBy({
    by: ['uploadedByUserId'],
    _sum: { sizeBytes: true },
    _count: { id: true },
  })

  const userIds = grouped
    .map((g) => g.uploadedByUserId)
    .filter((id): id is string => Boolean(id))

  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : []

  const userMap = new Map(users.map((u) => [u.id, u]))

  let totalBytes = BigInt(0)
  let totalCount = 0
  const stats = grouped
    .map((g) => {
      const bytes = g._sum.sizeBytes ?? BigInt(0)
      totalBytes += bytes
      totalCount += g._count.id
      const id = g.uploadedByUserId ?? '__unknown__'
      const user = g.uploadedByUserId ? userMap.get(g.uploadedByUserId) ?? null : null
      return {
        userId: id,
        userName: user?.name ?? (g.uploadedByUserId ? '(deleted user)' : '(legacy / unknown)'),
        userEmail: user?.email ?? null,
        bytes: bytes.toString(),
        objectCount: g._count.id,
      }
    })
    .sort((a, b) => Number(BigInt(b.bytes) - BigInt(a.bytes)))

  return NextResponse.json({
    perUser: stats,
    totalBytes: totalBytes.toString(),
    totalObjectCount: totalCount,
  })
})
