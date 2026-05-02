/**
 * /api/usage/admin/users — admin's "everyone's usage" leaderboard
 *
 * Admin-only. Returns one row per user with windowed totals and
 * basic identity (name, displayName, role). Supports query params:
 *   - sort: 'total' (default) | 'today' | 'last7d' | 'last30d'
 *   - limit (default 100, max 500)
 *
 * Drill-in for a single user goes through GET /api/usage/users/:userId.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdminAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { getMultiUserUsageStats } from '@/lib/usage/usage-stats'

type SortKey = 'total' | 'today' | 'last7d' | 'last30d'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const sortRaw = searchParams.get('sort') || 'total'
  const sort: SortKey =
    sortRaw === 'today' || sortRaw === 'last7d' || sortRaw === 'last30d'
      ? sortRaw
      : 'total'
  const limit = Math.min(
    parseInt(searchParams.get('limit') || '100', 10) || 100,
    500,
  )

  // Fetch all users that ever submitted a task — saves us from
  // returning rows for dormant accounts. Admin who wants the full
  // user list goes to /api/admin/users.
  const userRows = await prisma.user.findMany({
    where: {
      tasks: { some: {} },
    },
    select: {
      id: true,
      name: true,
      displayName: true,
      role: true,
      isActive: true,
    },
  })

  const stats = await getMultiUserUsageStats(userRows.map((u) => u.id))

  const merged = userRows.map((u) => {
    const w = stats.get(u.id) || {
      today: { total: 0, video: 0, image: 0, analyze: 0, voice: 0, other: 0 },
      last7d: { total: 0, video: 0, image: 0, analyze: 0, voice: 0, other: 0 },
      last30d: { total: 0, video: 0, image: 0, analyze: 0, voice: 0, other: 0 },
      allTime: { total: 0, video: 0, image: 0, analyze: 0, voice: 0, other: 0 },
    }
    return {
      userId: u.id,
      userName: u.name,
      displayName: u.displayName,
      role: u.role,
      isActive: u.isActive,
      windows: w,
    }
  })

  merged.sort((a, b) => {
    const ka = sort === 'total' ? a.windows.allTime.total : a.windows[sort].total
    const kb = sort === 'total' ? b.windows.allTime.total : b.windows[sort].total
    return kb - ka
  })

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    sort,
    users: merged.slice(0, limit),
  })
})
