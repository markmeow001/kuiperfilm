import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const configMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({ analysisModel: 'openai::vision-model' })),
}))
const guardMock = vi.hoisted(() => ({
  filterAuthorizedReferences: vi.fn<
    (keys: string[]) => Promise<{ safe: string[]; rejected: string[] }>
  >(async (keys) => ({ safe: keys, rejected: [] })),
}))
const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(async () => ({ taskId: 'analysis-task-1', status: 'queued' })),
}))

vi.mock('@/lib/config-service', () => configMock)
vi.mock('@/lib/playground/reference-guard', () => guardMock)
vi.mock('@/lib/task/submitter', () => submitterMock)

describe('POST /api/playground/analyze-video', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    configMock.getUserModelConfig.mockResolvedValue({ analysisModel: 'openai::vision-model' })
    guardMock.filterAuthorizedReferences.mockImplementation(async (keys: string[]) => ({ safe: keys, rejected: [] }))
    submitterMock.submitTask.mockResolvedValue({ taskId: 'analysis-task-1', status: 'queued' })
  })

  it('submits an authorized video to the Task spine with the configured analysis model', async () => {
    const { POST } = await import('@/app/api/playground/analyze-video/route')
    const request = buildMockRequest({
      path: '/api/playground/analyze-video',
      method: 'POST',
      body: { videoKey: 'video/playground-ref/user-1/ref.mp4', locale: 'zh' },
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ taskId: 'analysis-task-1' })
    expect(submitterMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'playground',
      type: 'playground_video_analyze',
      payload: expect.objectContaining({ analysisModel: 'openai::vision-model' }),
    }))
  })

  it('rejects a foreign video reference before submitting', async () => {
    guardMock.filterAuthorizedReferences.mockResolvedValue({ safe: [], rejected: ['foreign'] })
    const { POST } = await import('@/app/api/playground/analyze-video/route')
    const request = buildMockRequest({
      path: '/api/playground/analyze-video',
      method: 'POST',
      body: { videoKey: 'foreign' },
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(403)
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })
})
