import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnrecoverableError, type Job } from 'bullmq'
import { TaskTerminatedError } from '@/lib/task/errors'
import { TASK_TYPE, type TaskBillingInfo, type TaskJobData } from '@/lib/task/types'

const taskServiceMock = vi.hoisted(() => ({
  getPaidVoiceProviderHandoffSnapshot: vi.fn(),
  rollbackTaskBillingForTask: vi.fn(),
  touchTaskHeartbeat: vi.fn(),
  tryMarkTaskCompleted: vi.fn(),
  tryMarkPaidVoiceTaskFailedBeforeProviderHandoff: vi.fn(),
  tryMarkPaidVoiceProviderTerminalFailure: vi.fn(),
  tryMarkTaskFailed: vi.fn(),
  tryMarkTaskProcessing: vi.fn(),
  tryUpdateTaskProgress: vi.fn(),
  updateTaskBillingInfo: vi.fn(),
}))

const billingMock = vi.hoisted(() => ({
  settleTaskBilling: vi.fn(),
}))

const publisherMock = vi.hoisted(() => ({
  publishTaskEvent: vi.fn(),
  publishTaskStreamEvent: vi.fn(),
}))

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/task/publisher', () => publisherMock)
vi.mock('@/lib/task/queues', () => ({ rateLimitAwareBackoff: vi.fn(() => 1_000) }))
vi.mock('@/lib/billing/runtime-usage', () => ({
  withTextUsageCollection: vi.fn(async <T>(operation: () => Promise<T>) => ({
    result: await operation(),
    textUsage: [],
  })),
}))
vi.mock('@/lib/logging/core', () => ({ createScopedLogger: vi.fn(() => loggerMock) }))
vi.mock('@/lib/logging/file-writer', () => ({ onProjectNameAvailable: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(async () => null) },
  },
}))

import { withTaskLifecycle } from '@/lib/workers/shared'

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

function createJob(overrides: Partial<Job<TaskJobData>> = {}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: TASK_TYPE.VOICE_LINE,
      locale: 'en',
      projectId: 'project-1',
      targetType: 'VoiceLine',
      targetId: 'line-1',
      userId: 'user-1',
      billingInfo: { ...frozenBilling },
      payload: {},
    },
    queueName: 'voice',
    opts: { attempts: 1 },
    attemptsMade: 0,
    ...overrides,
  } as unknown as Job<TaskJobData>
}

describe('worker terminal ownership and billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    publisherMock.publishTaskEvent.mockResolvedValue({})
    publisherMock.publishTaskStreamEvent.mockResolvedValue({})
    taskServiceMock.tryMarkTaskProcessing.mockResolvedValue(true)
    taskServiceMock.tryMarkTaskCompleted.mockResolvedValue(true)
    taskServiceMock.tryMarkTaskFailed.mockResolvedValue(true)
    taskServiceMock.tryMarkPaidVoiceTaskFailedBeforeProviderHandoff.mockResolvedValue(true)
    taskServiceMock.tryMarkPaidVoiceProviderTerminalFailure.mockResolvedValue(true)
    taskServiceMock.getPaidVoiceProviderHandoffSnapshot.mockResolvedValue({
      status: 'processing',
      progress: 0,
      handoff: { kind: 'none', externalId: null },
    })
    taskServiceMock.touchTaskHeartbeat.mockResolvedValue(true)
    taskServiceMock.updateTaskBillingInfo.mockResolvedValue({})
    taskServiceMock.rollbackTaskBillingForTask.mockResolvedValue({
      attempted: true,
      rolledBack: true,
      billingInfo: { ...frozenBilling, status: 'rolled_back' },
    })
    billingMock.settleTaskBilling.mockResolvedValue({
      ...frozenBilling,
      status: 'settled',
      chargedCost: 0.4,
    })
  })

  it('completion CAS loses to cancellation -> neither settles nor rolls back billing', async () => {
    taskServiceMock.tryMarkTaskCompleted.mockResolvedValueOnce(false)

    await expect(withTaskLifecycle(
      createJob(),
      async () => ({ actualDurationSeconds: 2 }),
    )).resolves.toBeUndefined()

    expect(taskServiceMock.tryMarkTaskCompleted).toHaveBeenCalledTimes(1)
    expect(billingMock.settleTaskBilling).not.toHaveBeenCalled()
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(taskServiceMock.updateTaskBillingInfo).not.toHaveBeenCalled()
  })

  it('completion CAS wins -> settles only after terminal ownership is acquired', async () => {
    const order: string[] = []
    taskServiceMock.tryMarkTaskCompleted.mockImplementationOnce(async () => {
      order.push('claim-completed')
      return true
    })
    billingMock.settleTaskBilling.mockImplementationOnce(async () => {
      order.push('settle')
      return { ...frozenBilling, status: 'settled' as const, chargedCost: 0.4 }
    })

    await withTaskLifecycle(
      createJob(),
      async () => ({ actualDurationSeconds: 2 }),
    )

    expect(order).toEqual(['claim-completed', 'settle'])
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(taskServiceMock.tryMarkTaskCompleted).toHaveBeenCalledWith(
      'task-1',
      { actualDurationSeconds: 2 },
      {
        billingInfo: expect.objectContaining({
          status: 'frozen',
          settlement: expect.objectContaining({ state: 'pending', attempts: 0 }),
        }),
        billedAt: expect.any(Date),
      },
    )
    expect(taskServiceMock.updateTaskBillingInfo).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'settled',
        settlement: expect.objectContaining({ state: 'settled' }),
      }),
      { billedAt: expect.any(Date) },
    )
  })

  it('[task-specific completion hook] -> [uses hook while default completion CAS remains untouched]', async () => {
    const completionClaim = vi.fn(async () => true)

    await withTaskLifecycle(
      createJob({ data: { ...createJob().data, billingInfo: undefined } }),
      async () => ({ outputUrl: 'images/package.zip' }),
      { completionClaim },
    )

    expect(completionClaim).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      result: { outputUrl: 'images/package.zip' },
    }))
    expect(taskServiceMock.tryMarkTaskCompleted).not.toHaveBeenCalled()
    expect(publisherMock.publishTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.completed' }),
    )
  })

  it('[task-specific overlap loser] -> [skips settlement and completed event when hook returns false]', async () => {
    const completionClaim = vi.fn(async () => false)

    await expect(withTaskLifecycle(
      createJob(),
      async () => ({ outputUrl: 'voice/exact.wav' }),
      { completionClaim },
    )).resolves.toBeUndefined()

    expect(completionClaim).toHaveBeenCalledTimes(1)
    expect(billingMock.settleTaskBilling).not.toHaveBeenCalled()
    expect(taskServiceMock.updateTaskBillingInfo).not.toHaveBeenCalled()
    expect(publisherMock.publishTaskEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.completed' }),
    )
  })

  it('[completed task queue retry] -> [processing CAS blocks handler and completion hook before any work]', async () => {
    taskServiceMock.tryMarkTaskProcessing.mockResolvedValueOnce(false)
    const handler = vi.fn(async () => ({ outputUrl: 'images/package.zip' }))
    const completionClaim = vi.fn(async () => true)

    await expect(withTaskLifecycle(
      createJob({ data: { ...createJob().data, billingInfo: undefined } }),
      handler,
      { completionClaim },
    )).resolves.toBeUndefined()

    expect(handler).not.toHaveBeenCalled()
    expect(completionClaim).not.toHaveBeenCalled()
    expect(taskServiceMock.tryMarkTaskCompleted).not.toHaveBeenCalled()
  })

  it('completion settlement failure stays recoverable and does not roll back or fail the output', async () => {
    const order: string[] = []
    taskServiceMock.tryMarkTaskCompleted.mockImplementationOnce(async () => {
      order.push('claim-completed')
      return true
    })
    billingMock.settleTaskBilling.mockImplementationOnce(async () => {
      order.push('settle')
      throw new Error('billing confirmation failed')
    })
    await expect(withTaskLifecycle(
      createJob(),
      async () => ({ actualDurationSeconds: 2 }),
    )).resolves.toBeUndefined()

    expect(order).toEqual(['claim-completed', 'settle'])
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(taskServiceMock.updateTaskBillingInfo).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'frozen',
        settlement: expect.objectContaining({
          state: 'pending',
          attempts: 1,
          lastError: 'billing confirmation failed',
        }),
      }),
      { billedAt: null },
    )
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(publisherMock.publishTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.completed' }),
    )
  })

  it('failure CAS loses to cancellation/completion -> does not roll back billing', async () => {
    taskServiceMock.tryMarkPaidVoiceTaskFailedBeforeProviderHandoff.mockResolvedValueOnce(false)
    taskServiceMock.getPaidVoiceProviderHandoffSnapshot
      .mockResolvedValueOnce({ status: 'processing', progress: 0, handoff: { kind: 'none', externalId: null } })
      .mockResolvedValueOnce({ status: 'failed', progress: 0, handoff: { kind: 'none', externalId: null } })
    const terminalReconcile = vi.fn(async () => 'deleted')

    await expect(withTaskLifecycle(
      createJob(),
      async () => {
        throw new Error('provider rejected request')
      },
      { terminalReconcile },
    )).rejects.toBeInstanceOf(UnrecoverableError)

    expect(taskServiceMock.tryMarkPaidVoiceTaskFailedBeforeProviderHandoff).toHaveBeenCalledTimes(1)
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(terminalReconcile).toHaveBeenCalledTimes(1)
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(billingMock.settleTaskBilling).not.toHaveBeenCalled()
  })

  it('failure CAS wins -> rolls back only after terminal ownership is acquired', async () => {
    const order: string[] = []
    taskServiceMock.tryMarkPaidVoiceTaskFailedBeforeProviderHandoff.mockImplementationOnce(async () => {
      order.push('claim-failed')
      return true
    })
    taskServiceMock.rollbackTaskBillingForTask.mockImplementationOnce(async () => {
      order.push('rollback')
      return {
        attempted: true,
        rolledBack: true,
        billingInfo: { ...frozenBilling, status: 'rolled_back' as const },
      }
    })

    await expect(withTaskLifecycle(
      createJob(),
      async () => {
        throw new Error('provider rejected request')
      },
    )).rejects.toBeInstanceOf(UnrecoverableError)

    expect(order).toEqual(['claim-failed', 'rollback'])
  })

  it('[task-specific durable output fails on final attempt] -> [marks failed, settles rollback, then reconciles terminal output]', async () => {
    const order: string[] = []
    taskServiceMock.tryMarkPaidVoiceTaskFailedBeforeProviderHandoff.mockImplementationOnce(async () => {
      order.push('claim-failed')
      return true
    })
    taskServiceMock.rollbackTaskBillingForTask.mockImplementationOnce(async () => {
      order.push('rollback')
      return {
        attempted: true,
        rolledBack: true,
        billingInfo: { ...frozenBilling, status: 'rolled_back' as const },
      }
    })
    const terminalReconcile = vi.fn(async () => {
      order.push('terminal-reconcile')
    })

    await expect(withTaskLifecycle(
      createJob(),
      async () => {
        throw Object.assign(new Error('publication failed'), { code: 'INVALID_PARAMS' })
      },
      { terminalReconcile },
    )).rejects.toBeInstanceOf(UnrecoverableError)

    expect(order).toEqual(['claim-failed', 'rollback', 'terminal-reconcile'])
    expect(terminalReconcile).toHaveBeenCalledTimes(1)
    expect(publisherMock.publishTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.failed' }),
    )
  })

  it('[failed event publication also fails] -> [does not skip durable terminal reconciliation]', async () => {
    publisherMock.publishTaskEvent.mockImplementation(async (event: { type: string }) => {
      if (event.type === 'task.failed') throw new Error('event transport unavailable')
      return {}
    })
    const terminalReconcile = vi.fn(async () => 'deleted')

    await expect(withTaskLifecycle(
      createJob({ data: { ...createJob().data, billingInfo: undefined } }),
      async () => {
        throw Object.assign(new Error('publication failed'), { code: 'INVALID_PARAMS' })
      },
      { terminalReconcile },
    )).rejects.toBeInstanceOf(UnrecoverableError)

    expect(terminalReconcile).toHaveBeenCalledTimes(1)
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({
      action: 'worker.failed.publish_failed',
    }))
  })

  it('[expired/unparseable FAL submit claim quarantine] -> [keeps active task/dedupe/freeze and performs 0 refund]', async () => {
    const terminalReconcile = vi.fn(async () => 'active')

    await expect(withTaskLifecycle(
      createJob(),
      async () => {
        throw new TaskTerminatedError(
          'task-1',
          'VOICE_PROVIDER_SUBMIT_RECONCILIATION_REQUIRED',
        )
      },
      { terminalReconcile },
    )).rejects.toBeInstanceOf(UnrecoverableError)

    expect(terminalReconcile).toHaveBeenCalledTimes(1)
    expect(taskServiceMock.tryMarkTaskProcessing).toHaveBeenCalledWith('task-1')
    expect(taskServiceMock.tryMarkTaskCompleted).not.toHaveBeenCalled()
    expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
    expect(taskServiceMock.rollbackTaskBillingForTask).not.toHaveBeenCalled()
    expect(taskServiceMock.updateTaskBillingInfo).not.toHaveBeenCalled()
    expect(billingMock.settleTaskBilling).not.toHaveBeenCalled()
    expect(publisherMock.publishTaskEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.failed' }),
    )
  })
})
