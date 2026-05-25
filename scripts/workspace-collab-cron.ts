/**
 * Phase 12.5 — workspace collaboration cron worker.
 *
 * Two scheduled jobs:
 *   1. Hourly  — expire pending EditRequests older than 7 days
 *   2. Daily   — hard-delete projects with deletedAt > 30 days
 *
 * Runs as a standalone tsx process (same pattern as scripts/watchdog.ts),
 * launched via `npm run start:collab-cron` and concurrently in the
 * dev/start scripts. Idempotent: re-running the same tick yields zero
 * extra work (queries filter on remaining-eligible rows only).
 *
 * Why a separate script and not BullMQ repeatable jobs:
 *   - The work is DB-only, no per-row job semantics needed
 *   - BullMQ repeat jobs have their own surprises (job ID dedup across
 *     restart, drift after worker crash). setInterval inside a process
 *     supervised by docker is simpler and easier to reason about.
 *
 * Intervals are configurable via env so local testing can use 30s
 * instead of 1hr:
 *   COLLAB_CRON_EXPIRE_INTERVAL_MS    default 3600000  (1 hour)
 *   COLLAB_CRON_HARD_DELETE_INTERVAL_MS default 86400000 (24 hours)
 *   COLLAB_CRON_REQUEST_TTL_DAYS       default 7
 *   COLLAB_CRON_DELETE_GRACE_DAYS      default 30
 */
import { createScopedLogger } from '@/lib/logging/core'
import {
  expireStaleRequests,
  hardDeleteExpiredProjects,
} from '@/lib/workspace-collab-jobs'

const EXPIRE_INTERVAL_MS = Number.parseInt(
  process.env.COLLAB_CRON_EXPIRE_INTERVAL_MS || '3600000',
  10,
) || 3600000
const HARD_DELETE_INTERVAL_MS = Number.parseInt(
  process.env.COLLAB_CRON_HARD_DELETE_INTERVAL_MS || '86400000',
  10,
) || 86400000
const REQUEST_TTL_DAYS = Number.parseInt(
  process.env.COLLAB_CRON_REQUEST_TTL_DAYS || '7',
  10,
) || 7
const DELETE_GRACE_DAYS = Number.parseInt(
  process.env.COLLAB_CRON_DELETE_GRACE_DAYS || '30',
  10,
) || 30

const logger = createScopedLogger({
  module: 'workspace-collab-cron',
  action: 'collab-cron.tick',
})

async function expireTick() {
  const startedAt = Date.now()
  try {
    const result = await expireStaleRequests()
    if (result.expired > 0) {
      logger.info({
        action: 'collab-cron.expire.ok',
        message: `expired ${result.expired} stale edit requests`,
        durationMs: Date.now() - startedAt,
        details: { expired: result.expired, ttlDays: REQUEST_TTL_DAYS },
      })
    }
  } catch (err) {
    logger.error({
      action: 'collab-cron.expire.failed',
      message: err instanceof Error ? err.message : 'expire tick failed',
      durationMs: Date.now() - startedAt,
      errorCode: 'INTERNAL_ERROR',
      retryable: true,
    })
  }
}

async function hardDeleteTick() {
  const startedAt = Date.now()
  try {
    const result = await hardDeleteExpiredProjects()
    if (result.hardDeleted > 0 || result.failed > 0) {
      logger.info({
        action: 'collab-cron.hard_delete.summary',
        message: `hard-delete sweep: ${result.hardDeleted} dropped, ${result.failed} failed of ${result.scanned} scanned`,
        durationMs: Date.now() - startedAt,
        details: result,
      })
    }
  } catch (err) {
    logger.error({
      action: 'collab-cron.hard_delete.failed',
      message: err instanceof Error ? err.message : 'hard-delete tick failed',
      durationMs: Date.now() - startedAt,
      errorCode: 'INTERNAL_ERROR',
      retryable: true,
    })
  }
}

logger.info({
  action: 'collab-cron.started',
  message: 'workspace collaboration cron started',
  details: {
    expireIntervalMs: EXPIRE_INTERVAL_MS,
    hardDeleteIntervalMs: HARD_DELETE_INTERVAL_MS,
    requestTtlDays: REQUEST_TTL_DAYS,
    deleteGraceDays: DELETE_GRACE_DAYS,
  },
})

// Run both ticks once at startup so a fresh container catches up on
// anything that accumulated while we were down.
void expireTick()
void hardDeleteTick()

setInterval(() => {
  void expireTick()
}, EXPIRE_INTERVAL_MS)

setInterval(() => {
  void hardDeleteTick()
}, HARD_DELETE_INTERVAL_MS)
