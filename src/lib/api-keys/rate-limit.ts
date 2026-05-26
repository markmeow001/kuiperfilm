/**
 * Per-API-key sliding-window rate limiter — Phase 5 (2026-05-25).
 *
 * Algorithm: Redis sorted set (ZSET) per key, score = timestamp_ms.
 * On each request:
 *   1. ZREMRANGEBYSCORE key 0 (now - 60000)   ← prune entries > 1 min old
 *   2. ZCARD key                              ← count remaining entries
 *   3. if < limit: ZADD key now now           ← record this hit
 *   4. EXPIRE key 120s                        ← TTL safety (cleanup)
 *
 * Atomicity: wrapped in a single MULTI/EXEC pipeline so concurrent
 * requests can't race past the limit by interleaving ZCARD + ZADD.
 *
 * Why ZSET over INCR/EXPIRE fixed-window:
 *   - Fixed window has 2× burst at boundary (60/min limit → 120 hits at
 *     :59→:01). Sliding window smooths this out.
 *   - ZSET lets us return `retryAfterMs` precisely (time until oldest
 *     entry ages out), instead of a fudgy "retry in N seconds".
 *
 * Falls open (allow request) on Redis errors — public API availability
 * trumps rate-limit precision. Logged so we know if Redis is sick.
 */

import { queueRedis } from '@/lib/redis'
import { logError as _ulogError } from '@/lib/logging/core'

const WINDOW_MS = 60_000  // 1 minute sliding window
const TTL_SECONDS = 120   // double the window for safety

export interface RateLimitResult {
  allowed: boolean
  /** How many calls remain in the current window. */
  remaining: number
  /** Milliseconds until the limit drops by 1 (oldest entry ages out).
   *  Only meaningful when allowed=false. */
  retryAfterMs: number
  /** True when we let the request through despite Redis being unreachable.
   *  Caller may want to surface this via a header for observability. */
  degraded: boolean
}

/**
 * Check + record a hit against the rate limit for an API key.
 *
 * Note: this MUTATES state — calling it twice burns 2 slots even if the
 * first call's caller decided to abort. So call it ONCE per inbound
 * request, exactly at the auth boundary, before doing any work.
 */
export async function checkAndRecordRateLimit(params: {
  apiKeyId: string
  reqPerMinute: number
}): Promise<RateLimitResult> {
  const { apiKeyId, reqPerMinute } = params
  const key = `apiRate:${apiKeyId}`
  const now = Date.now()
  const cutoff = now - WINDOW_MS

  try {
    // Pipeline: prune old → count → maybe add → set TTL. Atomic.
    const pipeline = queueRedis.multi()
    pipeline.zremrangebyscore(key, 0, cutoff)
    pipeline.zcard(key)
    const results = await pipeline.exec()
    if (!results) {
      // Pipeline returned null = connection issue. Degrade open.
      return { allowed: true, remaining: reqPerMinute, retryAfterMs: 0, degraded: true }
    }
    const countResult = results[1]
    if (!countResult || countResult[0]) {
      // Second slot is [error, value] tuple. Error in countResult[0] = bail.
      _ulogError('[rate-limit] zcard failed', countResult?.[0])
      return { allowed: true, remaining: reqPerMinute, retryAfterMs: 0, degraded: true }
    }
    const currentCount = typeof countResult[1] === 'number'
      ? countResult[1]
      : Number(countResult[1] ?? 0)

    if (currentCount >= reqPerMinute) {
      // Over limit — fetch oldest entry to compute precise retryAfterMs.
      const oldest = await queueRedis.zrange(key, 0, 0, 'WITHSCORES')
      const oldestScore = oldest.length >= 2 ? Number(oldest[1]) : now
      const retryAfterMs = Math.max(0, oldestScore + WINDOW_MS - now)
      return { allowed: false, remaining: 0, retryAfterMs, degraded: false }
    }

    // Under limit — record this hit + bump TTL.
    await queueRedis
      .multi()
      .zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 8)}`)
      .expire(key, TTL_SECONDS)
      .exec()

    return {
      allowed: true,
      remaining: reqPerMinute - currentCount - 1,
      retryAfterMs: 0,
      degraded: false,
    }
  } catch (error) {
    _ulogError('[rate-limit] redis failure, degrading open', error)
    return { allowed: true, remaining: reqPerMinute, retryAfterMs: 0, degraded: true }
  }
}
