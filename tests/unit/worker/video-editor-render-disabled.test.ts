import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  videoEditorProject: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))
const rendererMock = vi.hoisted(() => ({
  bundle: vi.fn(),
  renderMedia: vi.fn(),
  selectComposition: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@remotion/bundler', () => ({ bundle: rendererMock.bundle }))
vi.mock('@remotion/renderer', () => ({
  renderMedia: rendererMock.renderMedia,
  selectComposition: rendererMock.selectComposition,
}))

describe('VIDEO_EDITOR_RENDER worker freeze', () => {
  beforeEach(() => vi.clearAllMocks())

  it('[any durable render job] -> [explicit failure before DB, renderer, or persistence]', async () => {
    const { handleVideoEditorRenderTask } = await import('@/lib/workers/handlers/video-editor-render')
    const job = {
      data: {
        taskId: 'task-a',
        type: 'video_editor_render',
        userId: 'user-a',
        projectId: 'project-a',
        episodeId: 'episode-a',
        targetType: 'VideoEditorProject',
        targetId: 'editor-a',
        payload: { editorProjectId: 'editor-a' },
      },
    } as unknown as Job<TaskJobData>

    await expect(handleVideoEditorRenderTask(job)).rejects.toThrow('VIDEO_EDITOR_RENDER_DISABLED')
    expect(prismaMock.videoEditorProject.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.videoEditorProject.update).not.toHaveBeenCalled()
    expect(rendererMock.bundle).not.toHaveBeenCalled()
    expect(rendererMock.selectComposition).not.toHaveBeenCalled()
    expect(rendererMock.renderMedia).not.toHaveBeenCalled()
  })
})
