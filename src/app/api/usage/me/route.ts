/**
 * /api/usage/me — current user's own generation stats
 *
 * Anyone authenticated can call. Returns windowed counts (today / 7d /
 * 30d / all-time) bucketed into video / image / analyze / voice / other,
 * plus a `byType` breakdown sorted by descending count.
 */
import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { getUserUsageStats } from '@/lib/usage/usage-stats'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const stats = await getUserUsageStats(session.user.id)
  return NextResponse.json(stats)
})
