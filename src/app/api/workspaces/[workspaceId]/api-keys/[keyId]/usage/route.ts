/**
 * Per-key usage summary — powers the dev-console chart.
 *
 *   GET /api/workspaces/:workspaceId/api-keys/:keyId/usage?days=7
 *
 * Returns:
 *   {
 *     keyId,
 *     window: { days, since },
 *     totals: { requests, errors, p50DurationMs, p95DurationMs },
 *     dailyBuckets: [{ date, requests, errors, avgDurationMs }],
 *     topEndpoints: [{ endpoint, requests, errors }],
 *   }
 *
 * Aggregation is done in Node, not SQL, because:
 *   - workspaces will typically have < 100K rows in the trailing 30 days
 *     (10 keys × 60 req/min × 60 min × 24h × 30d / 1000s of churn ≈ ok)
 *   - Prisma's groupBy with HAVING + percentile windowing on MySQL 5.7
 *     is awkward; pulling rows + reducing in JS keeps the code simple
 *     and lets us evolve the buckets without DB churn.
 *
 * If usage volume crosses ~500K rows/day per key, switch to a
 * materialized rollup (cron job) and read from that here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

const DEFAULT_WINDOW_DAYS = 7
const MAX_WINDOW_DAYS = 30

async function requireKeyAdminAccess(workspaceId: string, userId: string) {
  const [ws, requester] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerEditorId: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])
  if (!ws) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_NOT_FOUND' })
  const isAdmin = roleAtLeast(requester?.role, 'admin')
  const isOwner = ws.ownerEditorId === userId
  if (!isAdmin && !isOwner) {
    throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_OWNER' })
  }
}

export const GET = apiHandler(async (
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; keyId: string }> },
) => {
  const { workspaceId, keyId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await requireKeyAdminAccess(workspaceId, session.user.id)

  // Confirm the key belongs to this workspace before exposing usage data.
  const key = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { id: true, workspaceId: true },
  })
  if (!key || key.workspaceId !== workspaceId) {
    throw new ApiError('NOT_FOUND', { code: 'API_KEY_NOT_FOUND' })
  }

  const url = new URL(req.url)
  const rawDays = url.searchParams.get('days')
  let days = DEFAULT_WINDOW_DAYS
  if (rawDays) {
    const n = Number.parseInt(rawDays, 10)
    if (Number.isFinite(n)) days = Math.min(MAX_WINDOW_DAYS, Math.max(1, n))
  }
  const since = new Date(Date.now() - days * 86_400_000)

  const rows = await prisma.apiKeyUsage.findMany({
    where: { apiKeyId: keyId, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: {
      endpoint: true,
      statusCode: true,
      durationMs: true,
      createdAt: true,
    },
  })

  // Daily buckets keyed by YYYY-MM-DD (UTC) to keep cross-tz consistency.
  const dailyMap = new Map<string, { requests: number; errors: number; durationSum: number }>()
  // Pre-populate every day in the window so the chart has no gaps.
  for (let i = 0; i < days; i += 1) {
    const d = new Date(since.getTime() + i * 86_400_000)
    dailyMap.set(d.toISOString().slice(0, 10), { requests: 0, errors: 0, durationSum: 0 })
  }
  const endpointMap = new Map<string, { requests: number; errors: number }>()
  const durations: number[] = []
  let totalRequests = 0
  let totalErrors = 0

  for (const r of rows) {
    totalRequests += 1
    const isError = r.statusCode >= 400
    if (isError) totalErrors += 1
    durations.push(r.durationMs)

    const dateKey = r.createdAt.toISOString().slice(0, 10)
    const bucket = dailyMap.get(dateKey) ?? { requests: 0, errors: 0, durationSum: 0 }
    bucket.requests += 1
    if (isError) bucket.errors += 1
    bucket.durationSum += r.durationMs
    dailyMap.set(dateKey, bucket)

    const epBucket = endpointMap.get(r.endpoint) ?? { requests: 0, errors: 0 }
    epBucket.requests += 1
    if (isError) epBucket.errors += 1
    endpointMap.set(r.endpoint, epBucket)
  }

  durations.sort((a, b) => a - b)
  const p = (frac: number) => {
    if (durations.length === 0) return 0
    const idx = Math.min(durations.length - 1, Math.floor(frac * durations.length))
    return durations[idx] ?? 0
  }

  const dailyBuckets = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      requests: b.requests,
      errors: b.errors,
      avgDurationMs: b.requests > 0 ? Math.round(b.durationSum / b.requests) : 0,
    }))

  const topEndpoints = Array.from(endpointMap.entries())
    .sort(([, a], [, b]) => b.requests - a.requests)
    .slice(0, 10)
    .map(([endpoint, b]) => ({ endpoint, requests: b.requests, errors: b.errors }))

  return NextResponse.json({
    keyId,
    window: { days, since: since.toISOString() },
    totals: {
      requests: totalRequests,
      errors: totalErrors,
      p50DurationMs: p(0.5),
      p95DurationMs: p(0.95),
    },
    dailyBuckets,
    topEndpoints,
  })
})
