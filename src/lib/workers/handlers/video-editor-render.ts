import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'

/**
 * The legacy Remotion editor accepted unversioned arbitrary media references.
 * Keep durable jobs explicitly terminal until a scoped render manifest exists.
 */
export async function handleVideoEditorRenderTask(_job: Job<TaskJobData>): Promise<never> {
  throw new Error('VIDEO_EDITOR_RENDER_DISABLED')
}
