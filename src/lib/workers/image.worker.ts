import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME, rateLimitAwareBackoff } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import {
  handleAssetHubImageTask,
  handleAssetHubModifyTask,
  handleCharacterImageTask,
  handleLocationImageTask,
  handleModifyAssetImageTask,
  handlePanelImageTask,
  handlePanelVariantTask,
  handlePropImageTask,
} from './handlers/image-task-handlers'
import { handlePlaygroundImageTask } from './handlers/playground-image'

type AnyObj = Record<string, unknown>

async function processImageTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.IMAGE_CHARACTER:
      return await handleCharacterImageTask(job)
    case TASK_TYPE.IMAGE_LOCATION:
      return await handleLocationImageTask(job)
    case TASK_TYPE.IMAGE_PROP:
      return await handlePropImageTask(job)
    case TASK_TYPE.REGENERATE_GROUP: {
      const payload = (job.data.payload || {}) as AnyObj
      if (payload.type === 'character') {
        return await handleCharacterImageTask(job)
      }
      return await handleLocationImageTask(job)
    }
    case TASK_TYPE.MODIFY_ASSET_IMAGE:
      return await handleModifyAssetImageTask(job)
    case TASK_TYPE.ASSET_HUB_IMAGE:
      return await handleAssetHubImageTask(job)
    case TASK_TYPE.ASSET_HUB_MODIFY:
      return await handleAssetHubModifyTask(job)
    case TASK_TYPE.IMAGE_PANEL:
      return await handlePanelImageTask(job)
    case TASK_TYPE.PANEL_VARIANT:
      return await handlePanelVariantTask(job)
    case TASK_TYPE.PLAYGROUND_IMAGE:
    case TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE:
      return await handlePlaygroundImageTask(job)
    default:
      throw new Error(`Unsupported image task type: ${job.data.type}`)
  }
}

export function createImageWorker() {
  // Phase 9.1 (2026-06-20) — Playground image jobs now ride the unified
  // Task spine (projectId='playground' sentinel), so they flow through
  // withTaskLifecycle + processImageTask like every other image task. The
  // old bespoke `type === 'playground_image'` bypass is gone.
  return new Worker<TaskJobData>(
    QUEUE_NAME.IMAGE,
    async (job) => {
      return await withTaskLifecycle(job, processImageTask)
    },
    {
      connection: queueRedis,
      // Default 2 — Tencent VOD AIGC has a low concurrency quota per account
      // (often 1-2 by default). Set QUEUE_CONCURRENCY_IMAGE=N to raise once
      // a higher quota is approved. Going beyond the upstream concurrency
      // surfaces as error 70000 (RequestLimitExceeded) at task-execution
      // time, which we now mark retryable so backoff kicks in either way.
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_IMAGE || '2', 10) || 2,
      settings: {
        // Rate-limit-aware backoff: 60/120/240/480/600s for RATE_LIMIT,
        // 2/4/8/16/32s for everything else. See queues.ts.
        backoffStrategy: rateLimitAwareBackoff,
      },
    },
  )
}
