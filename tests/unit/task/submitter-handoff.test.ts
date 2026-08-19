import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_EVENT_TYPE, TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

const serviceMock = vi.hoisted(() => ({
  createTask: vi.fn(),
  failActiveTaskAndRollback: vi.fn(),
  getTaskById: vi.fn(),
  markTaskEnqueueFailed: vi.fn(),
  markTaskEnqueued: vi.fn(),
  markTaskFailed: vi.fn(),
  rollbackTaskBillingForTask: vi.fn(),
  tryUpdateActiveTaskBillingInfo: vi.fn(),
  updateTaskPayload: vi.fn(),
}))
const queueMock = vi.hoisted(() => ({ addTaskJob: vi.fn() }))
const billingMock = vi.hoisted(() => ({
  buildDefaultTaskBillingInfo: vi.fn(),
  isBillableTaskType: vi.fn(),
  prepareTaskBilling: vi.fn(),
}))
const publishMock = vi.hoisted(() => vi.fn())
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/task/service', () => serviceMock)
vi.mock('@/lib/task/queues', () => queueMock)
vi.mock('@/lib/task/publisher', () => ({ publishTaskEvent: publishMock }))
vi.mock('@/lib/billing', () => ({
  ...billingMock,
  InsufficientBalanceError: class InsufficientBalanceError extends Error {
    required = 0
    available = 0
  },
}))
vi.mock('@/lib/logging/core', () => ({ createScopedLogger: vi.fn(() => loggerMock) }))
vi.mock('@/lib/llm-observe/stage-pipeline', () => ({
  getTaskFlowMeta: vi.fn(() => ({
    flowId: 'test-flow',
    flowStageTitle: 'Test',
    flowStageIndex: 1,
    flowStageTotal: 1,
  })),
}))
vi.mock('@/lib/run-runtime/service', () => ({
  attachTaskToRun: vi.fn(),
  createRun: vi.fn(),
}))
vi.mock('@/lib/run-runtime/workflow', () => ({
  isAiTaskType: vi.fn(() => false),
  workflowTypeFromTaskType: vi.fn(() => 'test'),
}))
vi.mock('@/lib/task/rate-limit', () => ({ enforceRateLimit: vi.fn() }))
vi.mock('@/lib/task/episode-conflict-guard', () => ({ assertNoEpisodeConflict: vi.fn() }))
vi.mock('@/lib/skills/server', () => ({ loadSkillConfigById: vi.fn() }))
vi.mock('@/lib/skills/constraints', () => ({ enforceConstraints: vi.fn() }))

import { submitTask } from '@/lib/task/submitter'

const frozenBilling: Extract<TaskBillingInfo, { billable: true }> = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.VOICE_LINE,
  apiType: 'voice',
  model: 'voice-model',
  quantity: 5,
  unit: 'second',
  maxFrozenCost: 1,
  action: 'voice.generate',
  freezeId: 'freeze-1',
  modeSnapshot: 'ENFORCE',
  status: 'frozen',
}

function createTaskRow(billingInfo: TaskBillingInfo | null = null) {
  return {
    id: 'task-1',
    status: 'queued',
    payload: {},
    billingInfo,
    priority: 0,
    maxAttempts: 5,
  }
}

function submission() {
  return {
    userId: 'user-1',
    locale: 'en' as const,
    projectId: 'project-1',
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'VoiceLine',
    targetId: 'line-1',
    payload: {},
  }
}

describe('task submitter queue handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BILLING_MODE = 'OFF'
    serviceMock.createTask.mockResolvedValue({ task: createTaskRow(), deduped: false })
    serviceMock.failActiveTaskAndRollback.mockResolvedValue({
      claimed: true,
      rollback: { attempted: false, rolledBack: true, billingInfo: null },
    })
    serviceMock.getTaskById.mockResolvedValue({ ...createTaskRow(), status: 'completed' })
    serviceMock.markTaskEnqueueFailed.mockResolvedValue({})
    serviceMock.markTaskEnqueued.mockResolvedValue({})
    serviceMock.markTaskFailed.mockResolvedValue(true)
    serviceMock.rollbackTaskBillingForTask.mockResolvedValue({
      attempted: true,
      rolledBack: true,
      billingInfo: { ...frozenBilling, status: 'rolled_back' },
    })
    serviceMock.tryUpdateActiveTaskBillingInfo.mockResolvedValue(true)
    serviceMock.updateTaskPayload.mockResolvedValue({})
    queueMock.addTaskJob.mockResolvedValue({ id: 'task-1' })
    billingMock.buildDefaultTaskBillingInfo.mockReturnValue(null)
    billingMock.isBillableTaskType.mockReturnValue(false)
    billingMock.prepareTaskBilling.mockResolvedValue(null)
    publishMock.mockResolvedValue({})
  })

  it('returns success when BullMQ accepted the job but enqueuedAt persistence fails', async () => {
    serviceMock.markTaskEnqueued.mockRejectedValueOnce(new Error('database temporarily unavailable'))

    await expect(submitTask(submission())).resolves.toMatchObject({
      success: true,
      taskId: 'task-1',
    })

    expect(queueMock.addTaskJob).toHaveBeenCalledOnce()
    expect(serviceMock.failActiveTaskAndRollback).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({
      action: 'task.submit.enqueue_marker_failed',
      details: expect.objectContaining({ queueAccepted: true, status: 'completed' }),
    }))
  })

  it('defers an ambiguous queue.add rejection to the watchdog without failing or refunding', async () => {
    queueMock.addTaskJob.mockRejectedValueOnce(new Error('redis rejected queue add'))

    await expect(submitTask(submission())).resolves.toMatchObject({
      success: true,
      taskId: 'task-1',
      status: 'queued',
    })

    expect(serviceMock.markTaskEnqueueFailed).toHaveBeenCalledWith(
      'task-1',
      'redis rejected queue add',
    )
    expect(serviceMock.failActiveTaskAndRollback).not.toHaveBeenCalled()
    expect(serviceMock.markTaskEnqueued).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_EVENT_TYPE.FAILED,
    }))
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({
      action: 'task.submit.enqueue_handoff_unknown',
      details: { queueAccepted: 'unknown' },
      retryable: true,
    }))
  })

  it('passes the in-memory frozen snapshot to CAS-first rollback when its DB write fails', async () => {
    process.env.BILLING_MODE = 'ENFORCE'
    const quoted = { ...frozenBilling, freezeId: null, status: 'quoted' as const }
    serviceMock.createTask.mockResolvedValueOnce({ task: createTaskRow(quoted), deduped: false })
    billingMock.isBillableTaskType.mockReturnValue(true)
    billingMock.buildDefaultTaskBillingInfo.mockReturnValue(quoted)
    billingMock.prepareTaskBilling.mockResolvedValueOnce(frozenBilling)
    serviceMock.tryUpdateActiveTaskBillingInfo.mockRejectedValueOnce(new Error('billing snapshot write failed'))

    await expect(submitTask(submission())).rejects.toThrow('billing snapshot write failed')

    expect(serviceMock.failActiveTaskAndRollback).toHaveBeenCalledWith({
      taskId: 'task-1',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'billing snapshot write failed',
      billingInfo: frozenBilling,
      clearDedupeKey: true,
    })
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
  })

  it('rolls back an unstored freeze and stops when cancellation wins billing preparation', async () => {
    process.env.BILLING_MODE = 'ENFORCE'
    const quoted = { ...frozenBilling, freezeId: null, status: 'quoted' as const }
    serviceMock.createTask.mockResolvedValueOnce({ task: createTaskRow(quoted), deduped: false })
    billingMock.isBillableTaskType.mockReturnValue(true)
    billingMock.buildDefaultTaskBillingInfo.mockReturnValue(quoted)
    billingMock.prepareTaskBilling.mockResolvedValueOnce(frozenBilling)
    serviceMock.tryUpdateActiveTaskBillingInfo.mockResolvedValueOnce(false)

    await expect(submitTask(submission())).rejects.toMatchObject({
      code: 'CONFLICT',
      details: expect.objectContaining({ code: 'TASK_TERMINATED_DURING_BILLING' }),
    })

    expect(serviceMock.rollbackTaskBillingForTask).toHaveBeenCalledOnce()
    expect(serviceMock.rollbackTaskBillingForTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      billingInfo: frozenBilling,
    })
    expect(serviceMock.failActiveTaskAndRollback).not.toHaveBeenCalled()
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })
})
