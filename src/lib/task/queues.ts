import { JobsOptions, Queue, type MinimalJob } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { QueueType, TaskType, TASK_TYPE, type TaskJobData } from './types'

export const QUEUE_NAME = {
  IMAGE: 'kuiper-image',
  VIDEO: 'kuiper-video',
  VOICE: 'kuiper-voice',
  TEXT: 'kuiper-text',
} as const

/**
 * Backoff strategy aware of Tencent VOD's RATE_LIMIT (error 70000,
 * RequestLimitExceeded). When an upstream provider rejects because
 * its account-level concurrency cap is full, exponential 2s base
 * (max ~32s after 5 attempts) is too aggressive — every retry hits
 * the same wall and the task fails permanently. Switching to a
 * minute-scale ramp gives the queue time to clear.
 *
 * - RATE_LIMIT: 60s, 120s, 240s, 480s, 600s (capped at 10 min)
 * - everything else: 2s, 4s, 8s, 16s, 32s (legacy default)
 *
 * Both branches use jitter implicitly via BullMQ's randomization
 * when configured at the worker level (we don't set jitter here so
 * no-op for now — opt in by passing `jitter` on BackoffOptions).
 */
export function rateLimitAwareBackoff(
  attemptsMade: number,
  _type?: string,
  err?: Error,
  _job?: MinimalJob,
): number {
  const code = err && (err as { code?: string }).code
  const exponent = Math.max(0, attemptsMade - 1)
  if (code === 'RATE_LIMIT') {
    return Math.min(60_000 * (2 ** exponent), 600_000)
  }
  return Math.min(2_000 * (2 ** exponent), 32_000)
}

const defaultJobOptions: JobsOptions = {
  removeOnComplete: 500,
  removeOnFail: 500,
  attempts: 5,
  // BullMQ resolves `type: 'custom'` against the worker's
  // `settings.backoffStrategy` registered when the Worker is
  // constructed. See image.worker.ts / video.worker.ts.
  backoff: {
    type: 'custom',
    delay: 2_000,
  },
}

export const imageQueue = new Queue<TaskJobData>(QUEUE_NAME.IMAGE, {
  connection: queueRedis,
  defaultJobOptions,
})

export const videoQueue = new Queue<TaskJobData>(QUEUE_NAME.VIDEO, {
  connection: queueRedis,
  defaultJobOptions,
})

export const voiceQueue = new Queue<TaskJobData>(QUEUE_NAME.VOICE, {
  connection: queueRedis,
  defaultJobOptions,
})

export const textQueue = new Queue<TaskJobData>(QUEUE_NAME.TEXT, {
  connection: queueRedis,
  defaultJobOptions,
})

const ALL_QUEUES = [imageQueue, videoQueue, voiceQueue, textQueue]

const IMAGE_TYPES = new Set<TaskType>([
  TASK_TYPE.IMAGE_PANEL,
  TASK_TYPE.IMAGE_CHARACTER,
  TASK_TYPE.IMAGE_LOCATION,
  TASK_TYPE.IMAGE_PROP,
  TASK_TYPE.PANEL_VARIANT,
  TASK_TYPE.MODIFY_ASSET_IMAGE,
  TASK_TYPE.REGENERATE_GROUP,
  TASK_TYPE.ASSET_HUB_IMAGE,
  TASK_TYPE.ASSET_HUB_MODIFY,
  TASK_TYPE.PLAYGROUND_IMAGE,
])

const VIDEO_TYPES = new Set<TaskType>([TASK_TYPE.VIDEO_PANEL, TASK_TYPE.LIP_SYNC, TASK_TYPE.VIDEO_MULTI_SHOT, TASK_TYPE.VIDEO_EDITOR_RENDER, TASK_TYPE.EPISODE_STITCH_MP4, TASK_TYPE.PLAYGROUND_VIDEO])
const VOICE_TYPES = new Set<TaskType>([
  TASK_TYPE.VOICE_LINE,
  TASK_TYPE.VOICE_DESIGN,
  TASK_TYPE.ASSET_HUB_VOICE_DESIGN,
])

export function getQueueTypeByTaskType(type: TaskType): QueueType {
  if (IMAGE_TYPES.has(type)) return 'image'
  if (VIDEO_TYPES.has(type)) return 'video'
  if (VOICE_TYPES.has(type)) return 'voice'
  return 'text'
}

export function getQueueByType(type: QueueType) {
  switch (type) {
    case 'image':
      return imageQueue
    case 'video':
      return videoQueue
    case 'voice':
      return voiceQueue
    case 'text':
    default:
      return textQueue
  }
}

export async function addTaskJob(data: TaskJobData, opts?: JobsOptions) {
  const queueType = getQueueTypeByTaskType(data.type)
  const queue = getQueueByType(queueType)
  const priority = typeof opts?.priority === 'number' ? opts.priority : 0
  return await queue.add(data.type, data, {
    jobId: data.taskId,
    priority,
    ...(opts || {}),
  })
}

export async function removeTaskJob(taskId: string) {
  for (const queue of ALL_QUEUES) {
    const job = await queue.getJob(taskId)
    if (!job) continue
    await job.remove()
    return true
  }
  return false
}
