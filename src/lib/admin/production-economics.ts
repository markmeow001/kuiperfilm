/**
 * Production Economics aggregations for admin dashboard.
 *
 * Computes 10 unit-economics metrics across a rolling window:
 *   1. generatedSeconds        — sum of panel durations with videoUrl
 *   2. deliveredSeconds        — same, restricted to panels in stitched episodes (proxy)
 *   3. deliveredRatio          — deliveredSeconds / generatedSeconds
 *   4. wasteRatio              — 1 - deliveredRatio
 *   5. totalTokens             — sum of inputTokens + outputTokens from UsageCost.metadata
 *   6. tokensPerGenSecond      — totalTokens / generatedSeconds
 *   7. tokensPerFinalSecond    — totalTokens / deliveredSeconds
 *   8. realCostPerMinute       — totalCost / (deliveredSeconds / 60)
 *   9. deliveryPricePerMinute  — admin-set benchmark (Phase 3, null until set)
 *  10. grossMargin             — (price - cost) / price (null until #9)
 *
 * Tier B (#2-4, #7) currently uses a PROXY: panels are considered
 * "delivered" if they belong to a NovelPromotionEpisode where
 * stitchStatus = 'completed'. Phase 2 will swap to an explicit
 * NovelPromotionPanel.includedInFinalCut flag.
 *
 * Tier C (#9-10) returns null until Phase 3 wires the benchmark.
 *
 * See docs/plans/2026-05-17-admin-production-economics.md
 */

import { prisma } from '@/lib/prisma'

export type GroupBy = 'global' | 'user' | 'week'

export interface EconomicsMetrics {
  generatedSeconds: number
  deliveredSeconds: number
  deliveredRatio: number | null
  wasteRatio: number | null
  totalTokens: number
  totalCost: number
  tokensPerGenSecond: number | null
  tokensPerFinalSecond: number | null
  realCostPerMinute: number | null
  deliveryPricePerMinute: number | null
  grossMargin: number | null
  currency: string
}

export interface EconomicsMeta {
  deliveredSource: 'proxy' | 'manual_flag'
  pricingSource: 'unset' | 'global_benchmark'
  snapshotAt: string
}

export interface GlobalEconomicsResponse {
  windowStart: string
  windowEnd: string
  metrics: EconomicsMetrics
  meta: EconomicsMeta
}

export interface UserEconomicsRow extends EconomicsMetrics {
  userId: string
  name: string | null
  email: string | null
  displayName: string | null
}

export interface UserEconomicsResponse {
  windowStart: string
  windowEnd: string
  meta: EconomicsMeta
  users: UserEconomicsRow[]
}

export interface WeekEconomicsRow extends EconomicsMetrics {
  weekStart: string
  weekEnd: string
}

export interface WeekEconomicsResponse {
  windowStart: string
  windowEnd: string
  meta: EconomicsMeta
  weeks: WeekEconomicsRow[]
}

const DEFAULT_CURRENCY = 'RMB'

/**
 * Resolve the admin-set delivery price per minute. Phase 3 will load
 * this from SystemConfig or env. Phase 1 returns null until configured.
 */
export function resolveDeliveryPricePerMinute(): number | null {
  const raw = process.env.DELIVERY_PRICE_PER_MINUTE
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function safeDiv(numerator: number, denominator: number): number | null {
  if (!denominator || !Number.isFinite(denominator)) return null
  if (!Number.isFinite(numerator)) return null
  return numerator / denominator
}

function toNumber(v: bigint | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return Number.isFinite(v) ? v : 0
}

/**
 * Compose the derived metric envelope from primitive aggregates.
 * Pure function — easy to unit test.
 */
export function composeMetrics(input: {
  generatedSeconds: number
  deliveredSeconds: number
  totalTokens: number
  totalCost: number
  deliveryPricePerMinute: number | null
  currency?: string
}): EconomicsMetrics {
  const {
    generatedSeconds,
    deliveredSeconds,
    totalTokens,
    totalCost,
    deliveryPricePerMinute,
    currency = DEFAULT_CURRENCY,
  } = input

  const deliveredRatio = safeDiv(deliveredSeconds, generatedSeconds)
  const wasteRatio = deliveredRatio === null ? null : Math.max(0, 1 - deliveredRatio)
  const realCostPerMinute = safeDiv(totalCost, deliveredSeconds / 60)
  const grossMargin =
    deliveryPricePerMinute === null || realCostPerMinute === null
      ? null
      : safeDiv(deliveryPricePerMinute - realCostPerMinute, deliveryPricePerMinute)

  return {
    generatedSeconds,
    deliveredSeconds,
    deliveredRatio,
    wasteRatio,
    totalTokens,
    totalCost,
    tokensPerGenSecond: safeDiv(totalTokens, generatedSeconds),
    tokensPerFinalSecond: safeDiv(totalTokens, deliveredSeconds),
    realCostPerMinute,
    deliveryPricePerMinute,
    grossMargin,
    currency,
  }
}

/**
 * Compute the inclusive [start, end) UTC range for a given lookback
 * window in weeks. "Now" is exclusive — we don't want to include the
 * current minute in totals that we report alongside historical.
 */
export function buildWindow(weeks: number): { start: Date; end: Date } {
  // NaN → default 4; otherwise clamp to [1, 12]
  const floored = Math.floor(weeks)
  const safeWeeks = Number.isFinite(floored)
    ? Math.max(1, Math.min(12, floored === 0 ? 1 : floored))
    : 4
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  end.setUTCDate(end.getUTCDate() + 1) // tomorrow 00:00 UTC (exclusive)
  const start = new Date(end)
  start.setUTCDate(end.getUTCDate() - safeWeeks * 7)
  return { start, end }
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ===================================================================
// Raw aggregates (SQL-only, no derived math)
// ===================================================================

interface PanelDurationAggregate {
  userId: string
  generatedSeconds: number
  deliveredSeconds: number
}

/**
 * Sum panel.duration grouped by user.
 * - generatedSeconds: all panels with videoUrl IS NOT NULL
 * - deliveredSeconds: same, restricted to panels whose episode has
 *   stitchStatus = 'completed' (Phase 1 proxy for "in final cut")
 */
export async function aggregatePanelDurations(
  start: Date,
  end: Date,
): Promise<PanelDurationAggregate[]> {
  // 4-level join: panel → storyboard → episode → npProject → project
  // npProject has unique projectId, project has userId.
  const rows = await prisma.$queryRaw<Array<{
    userId: string
    gen_seconds: number | string | null
    delivered_seconds: number | string | null
  }>>`
    SELECT
      p.userId AS userId,
      COALESCE(SUM(CASE WHEN panel.videoUrl IS NOT NULL THEN panel.duration END), 0) AS gen_seconds,
      COALESCE(SUM(
        CASE WHEN panel.videoUrl IS NOT NULL AND ep.stitchStatus = 'completed'
        THEN panel.duration END
      ), 0) AS delivered_seconds
    FROM novel_promotion_panels panel
    JOIN novel_promotion_storyboards sb ON sb.id = panel.storyboardId
    JOIN novel_promotion_episodes ep ON ep.id = sb.episodeId
    JOIN novel_promotion_projects npp ON npp.id = ep.novelPromotionProjectId
    JOIN projects p ON p.id = npp.projectId
    WHERE panel.createdAt >= ${start}
      AND panel.createdAt <  ${end}
    GROUP BY p.userId
  `

  return rows.map((r) => ({
    userId: r.userId,
    generatedSeconds: toNumber(r.gen_seconds),
    deliveredSeconds: toNumber(r.delivered_seconds),
  }))
}

interface UsageAggregate {
  userId: string
  totalTokens: number
  totalCost: number
}

/**
 * Sum tokens + cost grouped by user. Tokens live inside the
 * UsageCost.metadata JSON; cost is the Decimal column.
 *
 * We restrict to apiType='text' (LLM-style billing rows) for tokens —
 * image/video APIs bill per unit, not per token. Cost includes ALL
 * apiTypes (text + image + video + voice) since that's the real
 * provider spend.
 */
export async function aggregateUsage(
  start: Date,
  end: Date,
): Promise<UsageAggregate[]> {
  const rows = await prisma.$queryRaw<Array<{
    userId: string
    total_tokens: number | string | null
    total_cost: number | string | null
  }>>`
    SELECT
      userId,
      COALESCE(SUM(
        CASE WHEN apiType = 'text' THEN
          COALESCE(CAST(JSON_EXTRACT(metadata, '$.inputTokens') AS UNSIGNED), 0)
          + COALESCE(CAST(JSON_EXTRACT(metadata, '$.outputTokens') AS UNSIGNED), 0)
        ELSE 0 END
      ), 0) AS total_tokens,
      COALESCE(SUM(cost), 0) AS total_cost
    FROM usage_costs
    WHERE createdAt >= ${start}
      AND createdAt <  ${end}
    GROUP BY userId
  `

  return rows.map((r) => ({
    userId: r.userId,
    totalTokens: toNumber(r.total_tokens),
    totalCost: toNumber(r.total_cost),
  }))
}

interface UserInfo {
  id: string
  name: string | null
  email: string | null
  displayName: string | null
}

async function fetchUsersById(ids: string[]): Promise<Map<string, UserInfo>> {
  if (ids.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true, displayName: true },
  })
  return new Map(users.map((u) => [u.id, u]))
}

// ===================================================================
// Public composers (callable from API route)
// ===================================================================

const META_NOW = (): EconomicsMeta => ({
  deliveredSource: 'proxy',
  pricingSource: resolveDeliveryPricePerMinute() === null ? 'unset' : 'global_benchmark',
  snapshotAt: new Date().toISOString(),
})

export async function getGlobalEconomics(weeks: number): Promise<GlobalEconomicsResponse> {
  const { start, end } = buildWindow(weeks)
  const [panels, usage] = await Promise.all([
    aggregatePanelDurations(start, end),
    aggregateUsage(start, end),
  ])

  const generatedSeconds = panels.reduce((s, r) => s + r.generatedSeconds, 0)
  const deliveredSeconds = panels.reduce((s, r) => s + r.deliveredSeconds, 0)
  const totalTokens = usage.reduce((s, r) => s + r.totalTokens, 0)
  const totalCost = usage.reduce((s, r) => s + r.totalCost, 0)

  const price = resolveDeliveryPricePerMinute()

  return {
    windowStart: isoDay(start),
    windowEnd: isoDay(end),
    metrics: composeMetrics({
      generatedSeconds,
      deliveredSeconds,
      totalTokens,
      totalCost,
      deliveryPricePerMinute: price,
    }),
    meta: META_NOW(),
  }
}

export async function getEconomicsByUser(weeks: number): Promise<UserEconomicsResponse> {
  const { start, end } = buildWindow(weeks)
  const [panels, usage] = await Promise.all([
    aggregatePanelDurations(start, end),
    aggregateUsage(start, end),
  ])

  const price = resolveDeliveryPricePerMinute()
  const userIds = Array.from(new Set([...panels.map((p) => p.userId), ...usage.map((u) => u.userId)]))
  const userMap = await fetchUsersById(userIds)

  const panelMap = new Map(panels.map((p) => [p.userId, p]))
  const usageMap = new Map(usage.map((u) => [u.userId, u]))

  const users: UserEconomicsRow[] = userIds
    .map((id) => {
      const panel = panelMap.get(id)
      const u = usageMap.get(id)
      const userInfo = userMap.get(id)
      return {
        userId: id,
        name: userInfo?.name ?? null,
        email: userInfo?.email ?? null,
        displayName: userInfo?.displayName ?? null,
        ...composeMetrics({
          generatedSeconds: panel?.generatedSeconds ?? 0,
          deliveredSeconds: panel?.deliveredSeconds ?? 0,
          totalTokens: u?.totalTokens ?? 0,
          totalCost: u?.totalCost ?? 0,
          deliveryPricePerMinute: price,
        }),
      }
    })
    // sort by generated activity desc, so most active rises to top
    .sort((a, b) => b.generatedSeconds - a.generatedSeconds)

  return {
    windowStart: isoDay(start),
    windowEnd: isoDay(end),
    meta: META_NOW(),
    users,
  }
}

interface WeeklyAggRow {
  weekStart: string
  generatedSeconds: number
  deliveredSeconds: number
  totalTokens: number
  totalCost: number
}

async function aggregateWeekly(start: Date, end: Date): Promise<WeeklyAggRow[]> {
  // Weekly buckets by panel.createdAt (Monday-anchored ISO weeks).
  // YEARWEEK(..., 3) = ISO 8601 mode: Monday start, week 1 contains Jan 4.
  const panelRows = await prisma.$queryRaw<Array<{
    week_start: Date
    gen_seconds: number | string | null
    delivered_seconds: number | string | null
  }>>`
    SELECT
      DATE_SUB(DATE(panel.createdAt), INTERVAL WEEKDAY(panel.createdAt) DAY) AS week_start,
      COALESCE(SUM(CASE WHEN panel.videoUrl IS NOT NULL THEN panel.duration END), 0) AS gen_seconds,
      COALESCE(SUM(
        CASE WHEN panel.videoUrl IS NOT NULL AND ep.stitchStatus = 'completed'
        THEN panel.duration END
      ), 0) AS delivered_seconds
    FROM novel_promotion_panels panel
    JOIN novel_promotion_storyboards sb ON sb.id = panel.storyboardId
    JOIN novel_promotion_episodes ep ON ep.id = sb.episodeId
    WHERE panel.createdAt >= ${start} AND panel.createdAt < ${end}
    GROUP BY week_start
  `

  const usageRows = await prisma.$queryRaw<Array<{
    week_start: Date
    total_tokens: number | string | null
    total_cost: number | string | null
  }>>`
    SELECT
      DATE_SUB(DATE(createdAt), INTERVAL WEEKDAY(createdAt) DAY) AS week_start,
      COALESCE(SUM(
        CASE WHEN apiType = 'text' THEN
          COALESCE(CAST(JSON_EXTRACT(metadata, '$.inputTokens') AS UNSIGNED), 0)
          + COALESCE(CAST(JSON_EXTRACT(metadata, '$.outputTokens') AS UNSIGNED), 0)
        ELSE 0 END
      ), 0) AS total_tokens,
      COALESCE(SUM(cost), 0) AS total_cost
    FROM usage_costs
    WHERE createdAt >= ${start} AND createdAt < ${end}
    GROUP BY week_start
  `

  const byWeek = new Map<string, WeeklyAggRow>()
  for (const r of panelRows) {
    const key = isoDay(r.week_start)
    byWeek.set(key, {
      weekStart: key,
      generatedSeconds: toNumber(r.gen_seconds),
      deliveredSeconds: toNumber(r.delivered_seconds),
      totalTokens: 0,
      totalCost: 0,
    })
  }
  for (const r of usageRows) {
    const key = isoDay(r.week_start)
    const existing = byWeek.get(key) ?? {
      weekStart: key,
      generatedSeconds: 0,
      deliveredSeconds: 0,
      totalTokens: 0,
      totalCost: 0,
    }
    existing.totalTokens = toNumber(r.total_tokens)
    existing.totalCost = toNumber(r.total_cost)
    byWeek.set(key, existing)
  }

  return Array.from(byWeek.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export async function getEconomicsByWeek(weeks: number): Promise<WeekEconomicsResponse> {
  const { start, end } = buildWindow(weeks)
  const rows = await aggregateWeekly(start, end)
  const price = resolveDeliveryPricePerMinute()

  const weekly: WeekEconomicsRow[] = rows.map((r) => {
    const weekEndDate = new Date(r.weekStart + 'T00:00:00Z')
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6)
    return {
      weekStart: r.weekStart,
      weekEnd: isoDay(weekEndDate),
      ...composeMetrics({
        generatedSeconds: r.generatedSeconds,
        deliveredSeconds: r.deliveredSeconds,
        totalTokens: r.totalTokens,
        totalCost: r.totalCost,
        deliveryPricePerMinute: price,
      }),
    }
  })

  return {
    windowStart: isoDay(start),
    windowEnd: isoDay(end),
    meta: META_NOW(),
    weeks: weekly,
  }
}

// ===================================================================
// CSV serialisation
// ===================================================================

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return 'N/A'
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function fmtNum(v: number | null, decimals = 2): string {
  if (v === null || !Number.isFinite(v)) return 'N/A'
  return v.toFixed(decimals)
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

const METRIC_CSV_HEADER = [
  'generated_seconds',
  'delivered_seconds',
  'delivered_ratio',
  'waste_ratio',
  'total_tokens',
  'total_cost',
  'tokens_per_gen_second',
  'tokens_per_final_second',
  'real_cost_per_minute',
  'delivery_price_per_minute',
  'gross_margin',
  'currency',
]

function metricsToCsvRow(m: EconomicsMetrics): string[] {
  return [
    fmtNum(m.generatedSeconds, 1),
    fmtNum(m.deliveredSeconds, 1),
    fmtPct(m.deliveredRatio),
    fmtPct(m.wasteRatio),
    String(Math.round(m.totalTokens)),
    fmtNum(m.totalCost, 4),
    fmtNum(m.tokensPerGenSecond, 1),
    fmtNum(m.tokensPerFinalSecond, 1),
    fmtNum(m.realCostPerMinute, 4),
    m.deliveryPricePerMinute === null ? 'N/A' : fmtNum(m.deliveryPricePerMinute, 2),
    fmtPct(m.grossMargin),
    m.currency,
  ]
}

export function globalEconomicsToCsv(resp: GlobalEconomicsResponse): string {
  const header = ['window_start', 'window_end', ...METRIC_CSV_HEADER]
  const row = [resp.windowStart, resp.windowEnd, ...metricsToCsvRow(resp.metrics)]
  return [header, row].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n'
}

export function userEconomicsToCsv(resp: UserEconomicsResponse): string {
  const header = ['user_id', 'name', 'email', 'display_name', ...METRIC_CSV_HEADER]
  const rows = resp.users.map((u) => [
    u.userId,
    u.name ?? '',
    u.email ?? '',
    u.displayName ?? '',
    ...metricsToCsvRow(u),
  ])
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n'
}

export function weekEconomicsToCsv(resp: WeekEconomicsResponse): string {
  const header = ['week_start', 'week_end', ...METRIC_CSV_HEADER]
  const rows = resp.weeks.map((w) => [w.weekStart, w.weekEnd, ...metricsToCsvRow(w)])
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n'
}
