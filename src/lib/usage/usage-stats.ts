/**
 * Per-user usage aggregator. Reads from the existing Task table — every
 * "click → generate" action already lands a task row with userId, type,
 * createdAt, so we can build the stats panel without any new tracking
 * pipeline.
 *
 * Time windows: today / last 7 days / last 30 days / all time.
 * Categories: video / image / analyze / voice / other (see
 * task-categorizer.ts). Plus raw `byType` breakdown for power users
 * who want to see "image_character: 8 / image_location: 3" instead of
 * the rolled-up totals.
 *
 * Status filter: by default counts EVERY task the user submitted
 * (queued / processing / completed / failed). User asked for "點擊次
 * 數" which is intent count, not success count. Failed tasks still
 * imply real generation cost (worker fired, model called, errored
 * mid-flight), so they belong in the count for that perspective.
 */
import { prisma } from '@/lib/prisma'
import { categorizeTaskType, type UsageCategory, ALL_CATEGORIES } from './task-categorizer'

export interface UsageWindow {
  total: number
  video: number
  image: number
  analyze: number
  voice: number
  other: number
}

export interface UserUsageStats {
  userId: string
  generatedAt: string // ISO timestamp
  windows: {
    today: UsageWindow
    last7d: UsageWindow
    last30d: UsageWindow
    allTime: UsageWindow
  }
  /** Raw task.type → count, all-time. Sorted by descending count. */
  byType: Array<{ type: string; count: number; category: UsageCategory }>
}

interface TaskRow {
  type: string
  count: number
}

function emptyWindow(): UsageWindow {
  return { total: 0, video: 0, image: 0, analyze: 0, voice: 0, other: 0 }
}

function startOfTodayLocal(): Date {
  // Local-day boundary keyed off the server's TZ (Asia/Taipei in our
  // droplet env) — matches what 99% of users mean by "今天". If the
  // server moved to UTC we'd reconsider, but consistent with how the
  // billing dashboard already buckets.
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function nDaysAgo(n: number): Date {
  const d = startOfTodayLocal()
  d.setDate(d.getDate() - n)
  return d
}

/**
 * Aggregate task counts for a single user.
 *
 * Implementation: 4 GROUP BY queries (one per window), keyed by
 * task.type. Rolls up into category totals client-side. Each query
 * uses (userId, createdAt) which has good index support — userId is
 * already indexed and createdAt is monotonic so the date filter
 * narrows scans.
 *
 * If we ever needed real-time stats at scale we'd materialize this
 * into a denormalized stats table; for the demo / few-users phase
 * the live query is plenty fast (single-digit ms).
 */
export async function getUserUsageStats(userId: string): Promise<UserUsageStats> {
  const today = startOfTodayLocal()
  const day7 = nDaysAgo(7)
  const day30 = nDaysAgo(30)

  async function aggregate(since: Date | null): Promise<TaskRow[]> {
    const rows = await prisma.task.groupBy({
      by: ['type'],
      where: {
        userId,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { _all: true },
    })
    return rows.map((r) => ({ type: r.type, count: r._count._all }))
  }

  const [todayRows, day7Rows, day30Rows, allRows] = await Promise.all([
    aggregate(today),
    aggregate(day7),
    aggregate(day30),
    aggregate(null),
  ])

  function rollup(rows: TaskRow[]): UsageWindow {
    const out = emptyWindow()
    for (const { type, count } of rows) {
      const cat = categorizeTaskType(type)
      out[cat] += count
      out.total += count
    }
    return out
  }

  // byType is built from the all-time slice for stable ordering. Top
  // tasks first so UI can show "your most-used" with no extra sort.
  const byType = allRows
    .map((r) => ({
      type: r.type,
      count: r.count,
      category: categorizeTaskType(r.type),
    }))
    .sort((a, b) => b.count - a.count)

  return {
    userId,
    generatedAt: new Date().toISOString(),
    windows: {
      today: rollup(todayRows),
      last7d: rollup(day7Rows),
      last30d: rollup(day30Rows),
      allTime: rollup(allRows),
    },
    byType,
  }
}

/**
 * Aggregate stats for many users at once (admin dashboard / editor's
 * workspace usage view). Returns a per-user summary keyed by userId
 * with windowed totals only — `byType` detail requires drilling into
 * a single user via getUserUsageStats.
 */
export async function getMultiUserUsageStats(
  userIds: string[],
): Promise<Map<string, UserUsageStats['windows']>> {
  if (userIds.length === 0) return new Map()
  const today = startOfTodayLocal()
  const day7 = nDaysAgo(7)
  const day30 = nDaysAgo(30)

  async function aggregate(since: Date | null) {
    return prisma.task.groupBy({
      by: ['userId', 'type'],
      where: {
        userId: { in: userIds },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { _all: true },
    })
  }

  const [t, w7, w30, all] = await Promise.all([
    aggregate(today),
    aggregate(day7),
    aggregate(day30),
    aggregate(null),
  ])

  const out = new Map<string, UserUsageStats['windows']>()
  function ensure(uid: string) {
    if (!out.has(uid)) {
      out.set(uid, {
        today: emptyWindow(),
        last7d: emptyWindow(),
        last30d: emptyWindow(),
        allTime: emptyWindow(),
      })
    }
    return out.get(uid)!
  }
  for (const uid of userIds) ensure(uid)

  type AggRow = { userId: string; type: string; _count: { _all: number } }
  function fold(rows: AggRow[], window: keyof UserUsageStats['windows']) {
    for (const r of rows) {
      const w = ensure(r.userId)[window]
      const cat = categorizeTaskType(r.type)
      w[cat] += r._count._all
      w.total += r._count._all
    }
  }
  fold(t, 'today')
  fold(w7, 'last7d')
  fold(w30, 'last30d')
  fold(all, 'allTime')

  return out
}

export { ALL_CATEGORIES }
