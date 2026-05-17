/**
 * Admin: production economics dashboard data.
 *
 * GET /api/admin/production-economics
 *   weeks    1-12 (default 4)
 *   groupBy  'global' | 'user' | 'week' (default 'global')
 *   format   'json' | 'csv' (default 'json')
 *
 * Admin auth ONLY — no token bypass; this surface reveals cross-user
 * billing aggregates. See docs/plans/2026-05-17-admin-production-economics.md
 */
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  getGlobalEconomics,
  getEconomicsByUser,
  getEconomicsByWeek,
  globalEconomicsToCsv,
  userEconomicsToCsv,
  weekEconomicsToCsv,
  type GroupBy,
} from '@/lib/admin/production-economics'

function parseWeeks(raw: string | null): number {
  if (!raw) return 4
  const n = Number(raw)
  if (!Number.isFinite(n)) return 4
  return Math.max(1, Math.min(12, Math.floor(n)))
}

function parseGroupBy(raw: string | null): GroupBy {
  if (raw === 'user' || raw === 'week' || raw === 'global') return raw
  return 'global'
}

function parseFormat(raw: string | null): 'json' | 'csv' {
  return raw === 'csv' ? 'csv' : 'json'
}

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await requireAdminAuth()
  if (isErrorResponse(auth)) return auth

  const url = new URL(request.url)
  const weeks = parseWeeks(url.searchParams.get('weeks'))
  const groupBy = parseGroupBy(url.searchParams.get('groupBy'))
  const format = parseFormat(url.searchParams.get('format'))

  if (format === 'csv') {
    const filename = `economics-${groupBy}-${weeks}w-${new Date().toISOString().slice(0, 10)}.csv`
    let csv: string
    if (groupBy === 'user') {
      const data = await getEconomicsByUser(weeks)
      csv = userEconomicsToCsv(data)
    } else if (groupBy === 'week') {
      const data = await getEconomicsByWeek(weeks)
      csv = weekEconomicsToCsv(data)
    } else {
      const data = await getGlobalEconomics(weeks)
      csv = globalEconomicsToCsv(data)
    }
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  if (groupBy === 'user') {
    return NextResponse.json(await getEconomicsByUser(weeks))
  }
  if (groupBy === 'week') {
    return NextResponse.json(await getEconomicsByWeek(weeks))
  }
  return NextResponse.json(await getGlobalEconomics(weeks))
})
