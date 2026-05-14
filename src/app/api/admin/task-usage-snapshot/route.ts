/**
 * Admin: image / video task usage snapshot.
 *
 * GET /api/admin/task-usage-snapshot
 *
 * Counts succeeded / failed image_* and video_* tasks over the last
 * 7 days, with a daily breakdown. Mirrors the auth model of
 * /api/admin/llm-usage-snapshot — token header for headless agents,
 * admin session cookie for browser dashboards.
 *
 * Optional query params:
 *   ?days=N      override the lookback window (default 7, max 30)
 *   ?userId=ID   filter to a single user
 *
 * Auth: `x-snapshot-token: <LLM_USAGE_SNAPSHOT_TOKEN>` OR admin session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { headers as readHeaders } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

async function authorize(): Promise<NextResponse | null> {
  const expectedToken = process.env.LLM_USAGE_SNAPSHOT_TOKEN || ''
  if (expectedToken) {
    const incomingHeaders = await readHeaders()
    const provided = incomingHeaders.get('x-snapshot-token') || ''
    if (provided && provided === expectedToken) return null
  }
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  return null
}

interface TypeStatusRow {
  type: string
  status: string
  n: bigint | number
}

interface DailyRow {
  day: Date | string
  img_ok: bigint | number
  img_fail: bigint | number
  vid_ok: bigint | number
  vid_fail: bigint | number
}

function toNum(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'bigint' ? Number(v) : v
}

function toDayString(v: Date | string): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string') return v.slice(0, 10)
  return String(v)
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authError = await authorize()
  if (authError) return authError

  const url = new URL(request.url)
  const daysParam = Number(url.searchParams.get('days') ?? '7')
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 30 ? Math.floor(daysParam) : 7
  const userIdFilter = url.searchParams.get('userId')

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Use Prisma groupBy (typed) rather than raw SQL — keeps it portable
  // and matches the LLM-usage-snapshot pattern.
  const grouped = await prisma.task.groupBy({
    by: ['type', 'status'],
    where: {
      createdAt: { gte: since },
      ...(userIdFilter ? { userId: userIdFilter } : {}),
      OR: [{ type: { startsWith: 'image_' } }, { type: { startsWith: 'video_' } }],
    },
    _count: { _all: true },
  })

  type Bucket = { runs: number; succeeded: number; failed: number }
  const byType = new Map<string, Bucket>()
  for (const row of grouped) {
    const b = byType.get(row.type) ?? { runs: 0, succeeded: 0, failed: 0 }
    b.runs += row._count._all
    if (row.status === 'succeeded') b.succeeded += row._count._all
    if (row.status === 'failed') b.failed += row._count._all
    byType.set(row.type, b)
  }

  // Daily breakdown via raw SQL — Prisma groupBy doesn't do DATE().
  const userClause = userIdFilter ? `AND userId = '${userIdFilter.replace(/'/g, '')}'` : ''
  const daily = (await prisma.$queryRawUnsafe<DailyRow[]>(`
    SELECT
      DATE(createdAt) AS day,
      SUM(CASE WHEN type LIKE 'image_%' AND status='succeeded' THEN 1 ELSE 0 END) AS img_ok,
      SUM(CASE WHEN type LIKE 'image_%' AND status='failed' THEN 1 ELSE 0 END) AS img_fail,
      SUM(CASE WHEN type LIKE 'video_%' AND status='succeeded' THEN 1 ELSE 0 END) AS vid_ok,
      SUM(CASE WHEN type LIKE 'video_%' AND status='failed' THEN 1 ELSE 0 END) AS vid_fail
    FROM tasks
    WHERE createdAt >= ?
      AND (type LIKE 'image_%' OR type LIKE 'video_%')
      ${userClause}
    GROUP BY day
    ORDER BY day DESC
  `, since)).map((r) => ({
    day: toDayString(r.day),
    img_ok: toNum(r.img_ok),
    img_fail: toNum(r.img_fail),
    vid_ok: toNum(r.vid_ok),
    vid_fail: toNum(r.vid_fail),
  }))

  // Totals
  let imgTotal = 0, imgOk = 0, imgFail = 0, vidTotal = 0, vidOk = 0, vidFail = 0
  for (const [type, b] of byType) {
    if (type.startsWith('image_')) {
      imgTotal += b.runs
      imgOk += b.succeeded
      imgFail += b.failed
    } else if (type.startsWith('video_')) {
      vidTotal += b.runs
      vidOk += b.succeeded
      vidFail += b.failed
    }
  }

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    window: {
      from: since.toISOString(),
      to: new Date().toISOString(),
      days,
    },
    ...(userIdFilter ? { userId: userIdFilter } : {}),
    totals: {
      image: { total: imgTotal, succeeded: imgOk, failed: imgFail },
      video: { total: vidTotal, succeeded: vidOk, failed: vidFail },
    },
    byType: Array.from(byType.entries())
      .map(([type, b]) => ({ type, ...b }))
      .sort((a, b) => b.runs - a.runs),
    daily,
  })
})
