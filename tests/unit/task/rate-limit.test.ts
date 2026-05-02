/**
 * Unit test for enforceRateLimit — the per-user generate-task limiter
 * inserted into submitTask before any state mutation.
 *
 * Verifies:
 *   - within-limit calls pass
 *   - exceeding the limit throws ApiError('RATE_LIMIT')
 *   - 'other' bucket (housekeeping) is never limited
 *   - env var override is respected
 *   - 0 means "disabled" (not "block all")
 *   - the count query filters on userId + type set + 60s window
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    count: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.task.count.mockResolvedValue(0)
  // Reset env vars between tests
  delete process.env.RATE_LIMIT_VIDEO_PER_MIN
  delete process.env.RATE_LIMIT_IMAGE_PER_MIN
  delete process.env.RATE_LIMIT_ANALYZE_PER_MIN
  delete process.env.RATE_LIMIT_VOICE_PER_MIN
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('enforceRateLimit', () => {
  it('passes when count is under the default limit', async () => {
    prismaMock.task.count.mockResolvedValue(5)
    const { enforceRateLimit } = await import('@/lib/task/rate-limit')

    await expect(
      enforceRateLimit({ userId: 'u1', taskType: TASK_TYPE.VIDEO_PANEL }),
    ).resolves.toBeUndefined()

    const callArgs = prismaMock.task.count.mock.calls[0][0]
    expect(callArgs.where.userId).toBe('u1')
    expect(callArgs.where.type.in).toContain('video_panel')
    expect(callArgs.where.createdAt.gte).toBeInstanceOf(Date)
  })

  it('throws RATE_LIMIT when count >= limit (default video=60)', async () => {
    prismaMock.task.count.mockResolvedValue(60)
    const { enforceRateLimit } = await import('@/lib/task/rate-limit')

    await expect(
      enforceRateLimit({ userId: 'u1', taskType: TASK_TYPE.VIDEO_PANEL }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      details: expect.objectContaining({
        category: 'video',
        limit: 60,
        recentCount: 60,
        windowSeconds: 60,
      }),
    })
  })

  it('skips entirely for "other" category — never queries DB', async () => {
    const { enforceRateLimit } = await import('@/lib/task/rate-limit')

    // PANEL_LIP_SYNC not categorized → 'other'. Pick a real "other" type.
    // Looking at categorizer: things not in any set fall to 'other'.
    // Use a fake one to be safe — but enforceRateLimit takes TaskType.
    // STORY_TO_SCRIPT_RUN is in 'analyze'; need one in 'other'.
    // Per categorizer code, types not listed go to 'other'. None of the
    // real TASK_TYPE values are 'other' currently — to test 'other' we
    // pass a literal that isn't in any set.
    await expect(
      enforceRateLimit({ userId: 'u1', taskType: 'definitely_not_a_real_type' as never }),
    ).resolves.toBeUndefined()

    expect(prismaMock.task.count).not.toHaveBeenCalled()
  })

  it('respects env var override (image limit lowered to 2)', async () => {
    process.env.RATE_LIMIT_IMAGE_PER_MIN = '2'
    prismaMock.task.count.mockResolvedValue(2)
    const { enforceRateLimit } = await import('@/lib/task/rate-limit')

    await expect(
      enforceRateLimit({ userId: 'u1', taskType: TASK_TYPE.IMAGE_PANEL }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      details: expect.objectContaining({ limit: 2 }),
    })
  })

  it('treats env var = 0 as "disabled" (not "block everything")', async () => {
    process.env.RATE_LIMIT_VIDEO_PER_MIN = '0'
    prismaMock.task.count.mockResolvedValue(9999)
    const { enforceRateLimit } = await import('@/lib/task/rate-limit')

    await expect(
      enforceRateLimit({ userId: 'u1', taskType: TASK_TYPE.VIDEO_PANEL }),
    ).resolves.toBeUndefined()

    expect(prismaMock.task.count).not.toHaveBeenCalled()
  })

  it('falls back to default when env var is non-numeric garbage', async () => {
    process.env.RATE_LIMIT_VIDEO_PER_MIN = 'not-a-number'
    prismaMock.task.count.mockResolvedValue(60)
    const { enforceRateLimit } = await import('@/lib/task/rate-limit')

    // default video limit = 60 — so 60 should still trip
    await expect(
      enforceRateLimit({ userId: 'u1', taskType: TASK_TYPE.VIDEO_PANEL }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      details: expect.objectContaining({ limit: 60 }),
    })
  })

  it('uses a 60-second window in the count query', async () => {
    prismaMock.task.count.mockResolvedValue(0)
    const { enforceRateLimit } = await import('@/lib/task/rate-limit')

    const before = Date.now()
    await enforceRateLimit({ userId: 'u1', taskType: TASK_TYPE.IMAGE_PANEL })
    const after = Date.now()

    const callArgs = prismaMock.task.count.mock.calls[0][0]
    const since = (callArgs.where.createdAt.gte as Date).getTime()
    // since should be ~60s before now
    expect(since).toBeGreaterThanOrEqual(before - 60_000)
    expect(since).toBeLessThanOrEqual(after - 60_000 + 100) // tolerance
  })

  it('analyze category default is 30 (lower than image/video)', async () => {
    prismaMock.task.count.mockResolvedValue(30)
    const { enforceRateLimit } = await import('@/lib/task/rate-limit')

    await expect(
      enforceRateLimit({ userId: 'u1', taskType: TASK_TYPE.ANALYZE_NOVEL }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      details: expect.objectContaining({ category: 'analyze', limit: 30 }),
    })
  })
})
