/**
 * Admin: LLM-driven workflow usage snapshot.
 *
 * GET /api/admin/llm-usage-snapshot
 *
 * Returns task / graph_run statistics for the LLM-heavy workflow
 * types (analyze_novel, script_to_storyboard_run, regenerate_group,
 * character_profile_confirm, character_profile_batch_confirm,
 * reference_to_character, story_to_script_run) over the last 24h
 * and last 7d, plus a hardcoded 2026-05-01 baseline so callers can
 * compare attempt-amplification before/after the openrouter
 * max_tokens cap fix (commit 0ac18b0, deployed 2026-05-03).
 *
 * Auth: either admin session cookie (browser dashboard) OR
 * `x-snapshot-token` header matching env LLM_USAGE_SNAPSHOT_TOKEN
 * (cloud monitoring routines). Token-only mode avoids needing an
 * admin user-id dance for headless agents.
 *
 * Response shape:
 *   {
 *     generatedAt: string,
 *     baseline: { date, totals... },
 *     window24h: { from, to, byType: [...] },
 *     window7d:  { from, to, byTypeDay: [...] },
 *     verdict: { attemptToRunRatio: number, status: 'good' | 'amplifying' | 'unknown' }
 *   }
 */
import { NextRequest, NextResponse } from 'next/server'
import { headers as readHeaders } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const LLM_WORKFLOW_TYPES = [
  'analyze_novel',
  'script_to_storyboard_run',
  'regenerate_group',
  'character_profile_confirm',
  'character_profile_batch_confirm',
  'reference_to_character',
  'story_to_script_run',
  'auto_group_multi_shot',
] as const

// 2026-05-01 — pre-fix high-water-mark day. attempt:run ratio that day
// was ~1.4 with 38% failure rate, triggered by the uncapped max_tokens
// stream-drop loop fixed in commit 0ac18b0.
const BASELINE_2026_05_01 = {
  date: '2026-05-01',
  byType: {
    analyze_novel: { runs: 32, attempts: 37, failed: 6 },
    script_to_storyboard_run: { runs: 31, attempts: 41, failed: 14 },
    regenerate_group: { runs: 25, attempts: 45, failed: 13 },
    character_profile_confirm: { runs: 1, attempts: 3, failed: 0 },
  },
  totals: { runs: 89, attempts: 126, failed: 33 },
  attemptToRunRatio: 1.42,
  failureRate: 0.37,
  errorCodeBreakdown: {
    INTERNAL_ERROR: 22,
    RECONCILE_ORPHAN: 5,
    TASK_LOCALE_REQUIRED: 3,
    RATE_LIMIT: 3,
    CONFLICT: 1,
  },
}

interface ByTypeRow {
  type: string
  runs: number
  attempts: number
  failed: number
  errorCodes: Record<string, number>
}

async function authorize(): Promise<NextResponse | null> {
  const expectedToken = process.env.LLM_USAGE_SNAPSHOT_TOKEN || ''
  if (expectedToken) {
    const incomingHeaders = await readHeaders()
    const provided = incomingHeaders.get('x-snapshot-token') || ''
    if (provided && provided === expectedToken) {
      return null
    }
  }
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  return null
}

async function aggregateWindow(fromMs: number, toMs: number): Promise<ByTypeRow[]> {
  const fromDate = new Date(fromMs)
  const toDate = new Date(toMs)
  const grouped = await prisma.task.groupBy({
    by: ['type', 'status'],
    where: {
      createdAt: { gte: fromDate, lt: toDate },
      type: { in: [...LLM_WORKFLOW_TYPES] },
    },
    _count: { _all: true },
    _sum: { attempt: true },
  })

  const byType: Map<string, ByTypeRow> = new Map()
  for (const row of grouped) {
    const t = row.type
    const entry = byType.get(t) ?? {
      type: t,
      runs: 0,
      attempts: 0,
      failed: 0,
      errorCodes: {},
    }
    const count = row._count._all
    const attemptSum = row._sum.attempt ?? 0
    entry.runs += count
    entry.attempts += attemptSum
    if (row.status === 'failed') entry.failed += count
    byType.set(t, entry)
  }

  const failedRows = await prisma.task.groupBy({
    by: ['type', 'errorCode'],
    where: {
      createdAt: { gte: fromDate, lt: toDate },
      type: { in: [...LLM_WORKFLOW_TYPES] },
      status: 'failed',
      errorCode: { not: null },
    },
    _count: { _all: true },
  })
  for (const row of failedRows) {
    const entry = byType.get(row.type)
    if (!entry || !row.errorCode) continue
    entry.errorCodes[row.errorCode] = (entry.errorCodes[row.errorCode] ?? 0) + row._count._all
  }

  return Array.from(byType.values()).sort((a, b) => b.attempts - a.attempts)
}

function summarize(rows: ByTypeRow[]) {
  const totals = rows.reduce(
    (acc, r) => ({
      runs: acc.runs + r.runs,
      attempts: acc.attempts + r.attempts,
      failed: acc.failed + r.failed,
    }),
    { runs: 0, attempts: 0, failed: 0 },
  )
  const attemptToRunRatio = totals.runs > 0 ? totals.attempts / totals.runs : 0
  const failureRate = totals.runs > 0 ? totals.failed / totals.runs : 0
  return { totals, attemptToRunRatio, failureRate }
}

function deriveVerdict(attemptToRunRatio: number) {
  // < 1.3 = retries are rare (essentially 1 attempt per run, fix working).
  // 1.3 - 1.5 = some retry but acceptable.
  // > 1.5 = significant amplification, tighten cap further.
  if (attemptToRunRatio === 0) return 'unknown' as const
  if (attemptToRunRatio < 1.3) return 'good' as const
  if (attemptToRunRatio < 1.5) return 'borderline' as const
  return 'amplifying' as const
}

export const GET = apiHandler(async (_req: NextRequest) => {
  const denied = await authorize()
  if (denied) return denied

  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const window24hRows = await aggregateWindow(now - day, now)
  const window7dRows = await aggregateWindow(now - 7 * day, now)

  const summary24h = summarize(window24hRows)
  const summary7d = summarize(window7dRows)

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    baseline: BASELINE_2026_05_01,
    window24h: {
      from: new Date(now - day).toISOString(),
      to: new Date(now).toISOString(),
      byType: window24hRows,
      ...summary24h,
      verdict: deriveVerdict(summary24h.attemptToRunRatio),
    },
    window7d: {
      from: new Date(now - 7 * day).toISOString(),
      to: new Date(now).toISOString(),
      byType: window7dRows,
      ...summary7d,
    },
  })
})
