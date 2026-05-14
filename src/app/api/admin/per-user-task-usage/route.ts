/**
 * Admin: per-user weekly image/video task usage.
 *
 * GET /api/admin/per-user-task-usage?weeks=4
 *
 * Returns image/video generation counts per user per week (ISO weeks
 * starting Monday). Admin auth ONLY — no token bypass, since this
 * surface exposes cross-user activity counts.
 *
 * Response shape:
 *   {
 *     weeks: [{ weekStart: "YYYY-MM-DD", weekEnd: "YYYY-MM-DD" }, ...],
 *     users: [
 *       {
 *         userId, email, name, displayName, role,
 *         totals: { image: {completed, failed}, video: {completed, failed} },
 *         weekly: [
 *           {
 *             weekStart: "YYYY-MM-DD",
 *             image: { completed, failed },
 *             video: { completed, failed }
 *           }, ...
 *         ]
 *       }, ...
 *     ]
 *   }
 *
 * Sorting: users with the most activity in the window come first.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

interface WeeklyRow {
  user_id: string
  week_start: Date | string
  type_kind: 'image' | 'video'
  status: 'completed' | 'failed'
  n: bigint | number
}

interface UserRow {
  id: string
  email: string | null
  name: string | null
  displayName: string | null
  role: string
}

function toNum(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'bigint' ? Number(v) : v
}

function toIsoDay(v: Date | string): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string') return v.slice(0, 10)
  return String(v)
}

/**
 * Build the list of ISO-week start dates (Monday) covering the lookback
 * window, oldest first. We anchor at the Monday of the current week and
 * walk back, so users see "this week" as the rightmost column.
 */
function buildWeekStarts(weeks: number): string[] {
  const today = new Date()
  // 0 = Sunday, 1 = Monday in JS Date.getUTCDay()
  const dayOfWeek = today.getUTCDay()
  const daysSinceMonday = (dayOfWeek + 6) % 7  // 0 if Monday, 6 if Sunday
  const thisMonday = new Date(today)
  thisMonday.setUTCDate(today.getUTCDate() - daysSinceMonday)
  thisMonday.setUTCHours(0, 0, 0, 0)

  const out: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisMonday)
    d.setUTCDate(thisMonday.getUTCDate() - i * 7)
    out.push(toIsoDay(d))
  }
  return out
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return toIsoDay(d)
}

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await requireAdminAuth()
  if (isErrorResponse(auth)) return auth

  const url = new URL(request.url)
  const weeksParam = Number(url.searchParams.get('weeks') ?? '4')
  const weeks = Number.isFinite(weeksParam) && weeksParam > 0 && weeksParam <= 12
    ? Math.floor(weeksParam)
    : 4

  const weekStarts = buildWeekStarts(weeks)
  const windowStart = weekStarts[0]
  const since = new Date(windowStart + 'T00:00:00Z')

  // MySQL: YEARWEEK(date, 3) gives ISO 8601 week (Monday start). To get
  // the actual Monday date for grouping, we use DATE_SUB with WEEKDAY.
  // WEEKDAY returns 0=Monday … 6=Sunday, so DATE - WEEKDAY days = Monday.
  const rows = await prisma.$queryRaw<WeeklyRow[]>`
    SELECT
      userId AS user_id,
      DATE(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY)) AS week_start,
      CASE WHEN type LIKE 'image_%' THEN 'image' ELSE 'video' END AS type_kind,
      status,
      COUNT(*) AS n
    FROM tasks
    WHERE createdAt >= ${since}
      AND (type LIKE 'image_%' OR type LIKE 'video_%')
      AND status IN ('completed', 'failed')
    GROUP BY userId, week_start, type_kind, status
  `

  // Bucket by user
  type Bucket = { completed: number; failed: number }
  type UserData = {
    weekly: Map<string, { image: Bucket; video: Bucket }>
    totalRuns: number
  }
  const userBuckets = new Map<string, UserData>()
  const userIds = new Set<string>()
  for (const r of rows) {
    userIds.add(r.user_id)
    const ud = userBuckets.get(r.user_id) ?? { weekly: new Map(), totalRuns: 0 }
    const weekIso = toIsoDay(r.week_start)
    const wk = ud.weekly.get(weekIso) ?? {
      image: { completed: 0, failed: 0 },
      video: { completed: 0, failed: 0 },
    }
    const slot = wk[r.type_kind]
    const count = toNum(r.n)
    if (r.status === 'completed') slot.completed += count
    if (r.status === 'failed') slot.failed += count
    ud.totalRuns += count
    ud.weekly.set(weekIso, wk)
    userBuckets.set(r.user_id, ud)
  }

  // Pull user metadata for the active users
  const userMeta: UserRow[] = userIds.size > 0
    ? await prisma.user.findMany({
        where: { id: { in: Array.from(userIds) } },
        select: { id: true, email: true, name: true, displayName: true, role: true },
      })
    : []
  const metaMap = new Map(userMeta.map((u) => [u.id, u]))

  const users = Array.from(userBuckets.entries())
    .map(([userId, ud]) => {
      const meta = metaMap.get(userId)
      const weekly = weekStarts.map((ws) => {
        const wk = ud.weekly.get(ws)
        return {
          weekStart: ws,
          image: wk?.image ?? { completed: 0, failed: 0 },
          video: wk?.video ?? { completed: 0, failed: 0 },
        }
      })
      const totals = weekly.reduce(
        (acc, w) => ({
          image: {
            completed: acc.image.completed + w.image.completed,
            failed: acc.image.failed + w.image.failed,
          },
          video: {
            completed: acc.video.completed + w.video.completed,
            failed: acc.video.failed + w.video.failed,
          },
        }),
        { image: { completed: 0, failed: 0 }, video: { completed: 0, failed: 0 } },
      )
      return {
        userId,
        email: meta?.email ?? null,
        name: meta?.name ?? null,
        displayName: meta?.displayName ?? null,
        role: meta?.role ?? 'unknown',
        totals,
        weekly,
        totalRuns: ud.totalRuns,
      }
    })
    .sort((a, b) => b.totalRuns - a.totalRuns)

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    weeks: weekStarts.map((ws) => ({
      weekStart: ws,
      weekEnd: addDays(ws, 6),
    })),
    users,
  })
})
