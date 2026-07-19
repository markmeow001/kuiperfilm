import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

vi.mock('@/lib/ai-runtime', () => ({ executeAiVisionStep: vi.fn() }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn() }))
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: vi.fn(),
  toSignedUrlIfCos: vi.fn((key: string) => `signed:${key}`),
}))

import { handlePlaygroundVideoAnalyzeTask } from '@/lib/workers/handlers/playground-video-analyze'

function makeJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'analysis-1',
      type: 'playground_video_analyze',
      locale: 'zh',
      projectId: 'playground',
      targetType: 'playground-reconstruction',
      targetId: 'analysis-1',
      userId: 'user-1',
      payload,
    },
  } as unknown as Job<TaskJobData>
}

describe('handlePlaygroundVideoAnalyzeTask', () => {
  it('rejects a task without an authorized video reference payload', async () => {
    await expect(handlePlaygroundVideoAnalyzeTask(makeJob({
      analysisModel: 'openai::vision-model',
    }))).rejects.toThrow('PLAYGROUND_RECONSTRUCTION_VIDEO_REQUIRED')
  })

  it('rejects a task without a configured analysis model', async () => {
    await expect(handlePlaygroundVideoAnalyzeTask(makeJob({
      videoKey: 'video/playground-ref/user-1/ref.mp4',
    }))).rejects.toThrow('PLAYGROUND_RECONSTRUCTION_ANALYSIS_MODEL_REQUIRED')
  })
})
