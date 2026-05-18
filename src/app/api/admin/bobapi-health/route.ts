/**
 * Admin: BobAPI / Seedance video-provider health snapshot.
 *
 * GET /api/admin/bobapi-health
 *
 * Buckets the last N days of `video_multi_shot` Task rows by:
 *   - video provider (taijiai / tencent-vod / fal-ai / other), parsed
 *     from payload.videoModel ("provider::modelId"). Surfaces total /
 *     completed / failed / running per provider so admins can compare
 *     Seedance uptake to Kling uptake at a glance.
 *   - error code histogram for failed rows. We split on two levels:
 *       1. Task.errorCode (our wrapper — SEEDANCE_COMPOSITE_SUBMIT_FAILED,
 *          TAIJIAI_AUTH_FAILED, etc.)
 *       2. Provider-internal code parsed out of errorMessage JSON
 *          ({"code":"get_channel_failed"}). This is the BobAPI-side
 *          routing failure the user hit on 2026-05-18.
 *   - daily breakdown for the taijiai provider specifically — so the
 *     "did BobAPI just start failing today" question is answerable
 *     without reading 100 task rows.
 *
 * Returns up to 20 recent failed rows verbatim so ops can spot-check
 * sample errorMessages instead of opening the runs page.
 *
 * Optional query:
 *   ?days=N        lookback window (default 7, max 30)
 *   ?provider=ID   restrict everything to one provider (default = all)
 *
 * Auth: admin session OR `x-snapshot-token: <LLM_USAGE_SNAPSHOT_TOKEN>`
 *       header — mirrors task-usage-snapshot so off-box monitoring
 *       jobs can pull without SSH + DB password.
 */
import { NextRequest, NextResponse } from 'next/server'
import { headers as readHeaders } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const VIDEO_TASK_TYPE = 'video_multi_shot'
const MAX_RECENT_FAILURES = 20
const DEFAULT_DAYS = 7
const MAX_DAYS = 30

interface ProviderBucket {
  provider: string
  modelId: string | null
  total: number
  completed: number
  failed: number
  running: number
  failureRate: number | null
}

interface ErrorBucket {
  errorCode: string
  providerInternalCode: string | null
  count: number
  lastSeen: string
  sampleMessage: string
}

interface DailyBucket {
  day: string
  completed: number
  failed: number
}

interface RecentFailure {
  taskId: string
  createdAt: string
  finishedAt: string | null
  provider: string
  modelId: string | null
  errorCode: string | null
  providerInternalCode: string | null
  errorMessage: string | null
}

// payload.videoModel is "<provider>::<modelId>" (parseModelKeyStrict
// produces it; mirrored here client-side to avoid pulling that whole
// module into the admin route). Returns ['unknown', null] when malformed.
function parseProviderModelKey(value: unknown): [string, string | null] {
  if (typeof value !== 'string' || value.length === 0) return ['unknown', null]
  const idx = value.indexOf('::')
  if (idx === -1) return ['unknown', value]
  return [value.slice(0, idx), value.slice(idx + 2)]
}

// Pull "code":"<X>" out of the BobAPI / Tencent / fal error JSON we
// stash inside errorMessage. Returns null on no match.
function extractProviderInternalCode(message: string | null | undefined): string | null {
  if (!message) return null
  const m = /"code"\s*:\s*"([^"]+)"/.exec(message)
  return m ? m[1] : null
}

function toDayString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function authorize(): Promise<NextResponse | null> {
  const expectedToken = process.env.LLM_USAGE_SNAPSHOT_TOKEN || ''
  if (expectedToken) {
    const incoming = await readHeaders()
    const provided = incoming.get('x-snapshot-token') || ''
    if (provided && provided === expectedToken) return null
  }
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  return null
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authError = await authorize()
  if (authError) return authError

  const url = new URL(request.url)
  const daysRaw = Number(url.searchParams.get('days') ?? String(DEFAULT_DAYS))
  const days =
    Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= MAX_DAYS
      ? Math.floor(daysRaw)
      : DEFAULT_DAYS
  const providerFilter = url.searchParams.get('provider')?.trim() || null

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Pull raw rows — within a 30-day window for a 10-20 user internal
  // team this stays under 1k rows so JS aggregation is fine and keeps
  // the route portable across MySQL versions (JSON_EXTRACT shapes
  // differ between 5.7 / 8.0).
  const rows = await prisma.task.findMany({
    where: {
      type: VIDEO_TASK_TYPE,
      createdAt: { gte: since },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      finishedAt: true,
      errorCode: true,
      errorMessage: true,
      payload: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  // Aggregate by provider / model.
  const providerKey = (provider: string, modelId: string | null): string =>
    modelId ? `${provider}::${modelId}` : provider
  const providerByKey = new Map<string, ProviderBucket>()
  // Aggregate failed rows by error fingerprint.
  const errorByCode = new Map<string, ErrorBucket>()
  // Daily breakdown for the taijiai (BobAPI Seedance) provider —
  // the question the user is asking about.
  const dailyByDay = new Map<string, DailyBucket>()
  const recentFailures: RecentFailure[] = []

  for (const row of rows) {
    const payload = row.payload as Record<string, unknown> | null
    const videoModelRaw = payload && typeof payload === 'object' ? payload.videoModel : null
    const [provider, modelId] = parseProviderModelKey(videoModelRaw)

    if (providerFilter && provider !== providerFilter) continue

    const key = providerKey(provider, modelId)
    const bucket =
      providerByKey.get(key) ??
      ({ provider, modelId, total: 0, completed: 0, failed: 0, running: 0, failureRate: null } as ProviderBucket)
    bucket.total += 1
    if (row.status === 'completed') bucket.completed += 1
    else if (row.status === 'failed') bucket.failed += 1
    else if (row.status === 'queued' || row.status === 'processing') bucket.running += 1
    providerByKey.set(key, bucket)

    // Per-day for taijiai only — BobAPI is what we want to graph.
    if (provider === 'taijiai') {
      const day = toDayString(row.createdAt)
      const d = dailyByDay.get(day) ?? { day, completed: 0, failed: 0 }
      if (row.status === 'completed') d.completed += 1
      else if (row.status === 'failed') d.failed += 1
      dailyByDay.set(day, d)
    }

    if (row.status !== 'failed') continue

    const providerInternalCode = extractProviderInternalCode(row.errorMessage)
    const errorKey = `${row.errorCode ?? 'UNKNOWN'}::${providerInternalCode ?? ''}`
    const eb =
      errorByCode.get(errorKey) ??
      ({
        errorCode: row.errorCode ?? 'UNKNOWN',
        providerInternalCode,
        count: 0,
        lastSeen: row.createdAt.toISOString(),
        sampleMessage: (row.errorMessage ?? '').slice(0, 600),
      } as ErrorBucket)
    eb.count += 1
    if (row.createdAt.toISOString() > eb.lastSeen) {
      eb.lastSeen = row.createdAt.toISOString()
      eb.sampleMessage = (row.errorMessage ?? '').slice(0, 600)
    }
    errorByCode.set(errorKey, eb)

    if (recentFailures.length < MAX_RECENT_FAILURES) {
      recentFailures.push({
        taskId: row.id,
        createdAt: row.createdAt.toISOString(),
        finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
        provider,
        modelId,
        errorCode: row.errorCode,
        providerInternalCode,
        errorMessage: row.errorMessage ? row.errorMessage.slice(0, 600) : null,
      })
    }
  }

  // Compute failure rate per provider (post-aggregation so it's stable).
  for (const bucket of providerByKey.values()) {
    const settled = bucket.completed + bucket.failed
    bucket.failureRate = settled > 0 ? bucket.failed / settled : null
  }

  // Sort provider buckets by total desc.
  const providers = Array.from(providerByKey.values()).sort((a, b) => b.total - a.total)
  // Sort error buckets by count desc.
  const errorBreakdown = Array.from(errorByCode.values()).sort((a, b) => b.count - a.count)
  // Sort daily by day asc so a UI line chart reads left → right.
  const dailySeedance = Array.from(dailyByDay.values()).sort((a, b) => a.day.localeCompare(b.day))

  // Overall taijiai summary — repeated at the top so off-box jobs can
  // alert on `seedance.failureRate > X` without scanning the providers
  // array.
  const taijiaiSummary = providers.find((p) => p.provider === 'taijiai') ?? {
    provider: 'taijiai',
    modelId: null,
    total: 0,
    completed: 0,
    failed: 0,
    running: 0,
    failureRate: null,
  }

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    window: {
      from: since.toISOString(),
      to: new Date().toISOString(),
      days,
    },
    ...(providerFilter ? { providerFilter } : {}),
    seedance: taijiaiSummary,
    providers,
    errorBreakdown,
    dailySeedance,
    recentFailures,
  })
})
