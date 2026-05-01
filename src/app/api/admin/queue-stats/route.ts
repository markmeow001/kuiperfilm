/**
 * Admin: BullMQ queue health snapshot.
 *
 * GET /api/admin/queue-stats
 *
 * Returns waiting / active / completed / failed / delayed counts for
 * each queue (image / video / voice / text) plus the configured
 * concurrency from QUEUE_CONCURRENCY_<TYPE> env vars. The configured
 * concurrency matters for diagnosing Tencent SubAppId throttling
 * (demo SubAppId is limited to ~1-2 concurrent calls).
 */
import { NextResponse } from 'next/server'
import type { Queue } from 'bullmq'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { imageQueue, videoQueue, voiceQueue, textQueue } from '@/lib/task/queues'

interface QueueSnapshot {
  name: string
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
  paused: boolean
  concurrency: number | null
}

async function snapshot(queue: Queue, concurrencyEnvKey: string): Promise<QueueSnapshot> {
  const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
    queue.isPaused(),
  ])
  const concurrencyRaw = process.env[concurrencyEnvKey]
  const concurrency = concurrencyRaw ? Number.parseInt(concurrencyRaw, 10) : null
  return {
    name: queue.name,
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused,
    concurrency: Number.isFinite(concurrency) ? concurrency : null,
  }
}

export const GET = apiHandler(async () => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const queues = await Promise.all([
    snapshot(imageQueue, 'QUEUE_CONCURRENCY_IMAGE'),
    snapshot(videoQueue, 'QUEUE_CONCURRENCY_VIDEO'),
    snapshot(voiceQueue, 'QUEUE_CONCURRENCY_VOICE'),
    snapshot(textQueue, 'QUEUE_CONCURRENCY_TEXT'),
  ])

  return NextResponse.json({ queues, generatedAt: new Date().toISOString() })
})
