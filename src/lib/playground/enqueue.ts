/**
 * Phase T-2 (2026-05-27) — Playground job enqueue helpers.
 *
 * The Playground flow does NOT go through `submitTask` because the Task
 * table is project-scoped (Task.projectId NOT NULL). We dispatch directly
 * to the video BullMQ queue with a non-Task job shape; the worker's
 * type-based router branches on `job.data.type === 'playground_video'`.
 *
 * For job tracking, the PlaygroundRun row is the source of truth —
 * status / errorMessage / resultUrls / externalTaskId all live there.
 * BullMQ provides retry/backoff infrastructure but no DB ownership.
 */

import { videoQueue } from '@/lib/task/queues'
import type { TaskJobData } from '@/lib/task/types'
import type { PlaygroundVideoJobData } from '@/lib/workers/handlers/playground-video'

/**
 * Enqueue a video generation job for an existing PlaygroundRun row.
 *
 * @param playgroundRunId  the row id (must already exist in 'pending')
 * @param userId           owning user, for generator's model-config lookup
 * @returns                the BullMQ job id
 */
export async function enqueuePlaygroundVideoJob(params: {
  playgroundRunId: string
  userId: string
}): Promise<{ jobId: string }> {
  const data: PlaygroundVideoJobData = {
    type: 'playground_video',
    playgroundRunId: params.playgroundRunId,
    userId: params.userId,
  }
  // The videoQueue type is Queue<TaskJobData> but the worker accepts a
  // union (TaskJobData | PlaygroundVideoJobData) and branches on the
  // `type === 'playground_video'` marker. Cast is intentional — the
  // worker case-router handles the disjoint shape correctly.
  const job = await videoQueue.add('playground_video', data as unknown as TaskJobData, {
    // Deduplicate by run id — if API gets two clicks before the first
    // job lands, the second collapses into the same job. BullMQ jobId
    // uniqueness handles this naturally.
    // NOTE: BullMQ forbids ":" in a custom jobId (it's the Redis key
    // separator) — it throws "Custom Id cannot contain :". Use "-".
    // playgroundRunId is a UUID (no colon) so uniqueness is preserved.
    jobId: `playground-video-${params.playgroundRunId}`,
    // 3 attempts — for transient network / rate-limit blips. The
    // generator-side rate-limit-aware backoff in queues.ts handles
    // the spacing.
    attempts: 3,
  })
  return { jobId: job.id ?? `playground-video-${params.playgroundRunId}` }
}
