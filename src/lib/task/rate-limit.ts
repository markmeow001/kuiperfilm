/**
 * Per-user rate limit on generate-class tasks.
 *
 * Threat model: a 10-20 person internal team. The realistic risk isn't
 * an adversarial outsider, it's a single team member whose account
 * runs a UI loop / page-refresh storm and burns through Tencent VOD
 * concurrency or LLM quota in a few minutes. We can't rely on the
 * Tencent provider rate limit alone — the platform should fail
 * deterministically before money leaves the wallet.
 *
 * Approach: query the existing Task table for recent rows. No Redis
 * counters, no external state — single source of truth. Limits apply
 * per-user across the whole platform (not per-project), since "loop
 * bug" doesn't respect project boundaries.
 *
 * Limits live in env so we can tune without redeploy. Defaults are
 * loose enough that normal storyboard generation (17 panels in one
 * batch) sails through, but tight enough that a runaway loop trips
 * within a minute.
 *
 *   RATE_LIMIT_VIDEO_PER_MIN     default 60
 *   RATE_LIMIT_IMAGE_PER_MIN     default 120
 *   RATE_LIMIT_ANALYZE_PER_MIN   default 30
 *   RATE_LIMIT_VOICE_PER_MIN     default 60
 *
 * Setting any of these to 0 disables the limit for that category
 * (useful for one-off bulk imports — flip via env var, restart, run,
 * flip back).
 */
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import {
  categorizeTaskType,
  getTaskTypesForCategory,
  type UsageCategory,
} from '@/lib/usage/task-categorizer'
import type { TaskType } from './types'

const RATE_WINDOW_MS = 60_000

interface RateLimitConfig {
  video: number
  image: number
  analyze: number
  voice: number
}

function readLimitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

function loadConfig(): RateLimitConfig {
  return {
    video: readLimitFromEnv('RATE_LIMIT_VIDEO_PER_MIN', 60),
    image: readLimitFromEnv('RATE_LIMIT_IMAGE_PER_MIN', 120),
    analyze: readLimitFromEnv('RATE_LIMIT_ANALYZE_PER_MIN', 30),
    voice: readLimitFromEnv('RATE_LIMIT_VOICE_PER_MIN', 60),
  }
}

function limitForCategory(category: UsageCategory, cfg: RateLimitConfig): number | null {
  switch (category) {
    case 'video':
      return cfg.video
    case 'image':
      return cfg.image
    case 'analyze':
      return cfg.analyze
    case 'voice':
      return cfg.voice
    case 'other':
      return null // never limit housekeeping tasks
  }
}

export interface EnforceRateLimitParams {
  userId: string
  taskType: TaskType
}

/**
 * Throws ApiError('RATE_LIMIT', ...) if the user has submitted more
 * than the per-category limit in the last 60 seconds.
 *
 * Counts by Task.createdAt across ALL statuses (queued / running /
 * completed / failed). Failed tasks count too — the user still
 * consumed a "click", and a tight failure loop is the exact runaway
 * we're trying to catch.
 */
export async function enforceRateLimit(params: EnforceRateLimitParams): Promise<void> {
  const category = categorizeTaskType(params.taskType)
  const cfg = loadConfig()
  const limit = limitForCategory(category, cfg)

  if (limit === null) return // 'other' bucket: never limited
  if (limit === 0) return // explicitly disabled via env (set to 0)

  const types = getTaskTypesForCategory(category)
  if (types.length === 0) return // shouldn't happen for non-'other' but defensive

  const since = new Date(Date.now() - RATE_WINDOW_MS)

  const recentCount = await prisma.task.count({
    where: {
      userId: params.userId,
      type: { in: types },
      createdAt: { gte: since },
    },
  })

  if (recentCount >= limit) {
    throw new ApiError('RATE_LIMIT', {
      category,
      limit,
      windowSeconds: RATE_WINDOW_MS / 1000,
      recentCount,
      message: `Too many ${category} requests in the last minute (${recentCount}/${limit}). Please wait a moment and retry.`,
    })
  }
}
