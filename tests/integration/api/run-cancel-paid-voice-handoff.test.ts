import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const runServiceMock = vi.hoisted(() => ({
  getRunById: vi.fn(),
  requestRunCancel: vi.fn(),
}))
const taskServiceMock = vi.hoisted(() => ({
  cancelTask: vi.fn(),
}))
const publisherMock = vi.hoisted(() => ({
  publishRunEvent: vi.fn(),
}))

vi.mock('@/lib/run-runtime/service', () => runServiceMock)
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/run-runtime/publisher', () => publisherMock)

const run = {
  id: 'run-1',
  userId: 'run-owner',
  projectId: 'project-1',
  taskId: 'task-1',
  status: 'running',
}

describe('POST /api/runs/[runId]/cancel paid voice handoff', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('editor-user')
    runServiceMock.getRunById.mockResolvedValue(run)
    runServiceMock.requestRunCancel.mockResolvedValue({ ...run, status: 'canceling' })
  })

  it('[provider handoff is protected] -> [409 and run state/event remain untouched]', async () => {
    taskServiceMock.cancelTask.mockResolvedValue({
      task: { id: 'task-1' },
      cancelled: false,
      providerHandoffProtected: true,
    })

    const { POST } = await import('@/app/api/runs/[runId]/cancel/route')
    const response = await callRoute(POST as never, {
      path: '/api/runs/run-1/cancel',
      method: 'POST',
      context: { params: Promise.resolve({ runId: 'run-1' }) } as never,
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { details: { code: 'VOICE_PROVIDER_CANCEL_RECONCILIATION_REQUIRED' } },
    })
    expect(runServiceMock.requestRunCancel).not.toHaveBeenCalled()
    expect(publisherMock.publishRunEvent).not.toHaveBeenCalled()
  })

  it('[authorized collaborator cancels an unprotected task] -> [updates the owner-scoped run and publishes once]', async () => {
    taskServiceMock.cancelTask.mockResolvedValue({
      task: { id: 'task-1' },
      cancelled: true,
      providerHandoffProtected: false,
    })

    const { POST } = await import('@/app/api/runs/[runId]/cancel/route')
    const response = await callRoute(POST as never, {
      path: '/api/runs/run-1/cancel',
      method: 'POST',
      context: { params: Promise.resolve({ runId: 'run-1' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(taskServiceMock.cancelTask).toHaveBeenCalledWith('task-1', 'Run cancelled by user')
    expect(runServiceMock.requestRunCancel).toHaveBeenCalledWith({
      runId: 'run-1',
      userId: 'run-owner',
    })
    expect(publisherMock.publishRunEvent).toHaveBeenCalledTimes(1)
  })
})
