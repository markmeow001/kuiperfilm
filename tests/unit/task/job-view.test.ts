import { describe, expect, it } from 'vitest'
import { toJobView } from '@/lib/task/job-view'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

type JobViewInput = Parameters<typeof toJobView>[0]

function task(overrides: Partial<JobViewInput> = {}): JobViewInput {
  return {
    id: 'task-1',
    type: TASK_TYPE.VIDEO_PANEL,
    targetType: 'StoryboardPanel',
    targetId: 'panel-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    status: TASK_STATUS.PROCESSING,
    progress: 42,
    payload: null,
    billingInfo: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-08-08T10:00:00.000Z'),
    updatedAt: new Date('2026-08-08T10:01:00.000Z'),
    queuedAt: new Date('2026-08-08T10:00:00.000Z'),
    startedAt: new Date('2026-08-08T10:00:10.000Z'),
    finishedAt: null,
    attempt: 1,
    maxAttempts: 3,
    ...overrides,
  }
}

describe('task job view', () => {
  it('已取消且额度已回滚 -> 主状态与退款状态独立呈现', () => {
    const view = toJobView(task({
      status: TASK_STATUS.FAILED,
      errorCode: 'TASK_CANCELLED',
      errorMessage: 'Task cancelled by user',
      finishedAt: new Date('2026-08-08T10:00:25.000Z'),
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: TASK_TYPE.VIDEO_PANEL,
        apiType: 'video',
        model: 'atlascloud::seedance-2.0-r2v',
        quantity: 1,
        unit: 'video',
        maxFrozenCost: 1.25,
        action: 'video.generate',
        status: 'rolled_back',
      },
    }))

    expect(view.status).toBe('cancelled')
    expect(view.refund).toEqual({ status: 'refunded', amount: null })
    expect(view.billingStatus).toBe('refunded')
    expect(view.cost).toEqual({ estimated: 1.25, actual: 0, currency: 'CNY' })
    expect(view.model).toBe('atlascloud::seedance-2.0-r2v')
    expect(view.error).toBeNull()
    expect(view.canCancel).toBe(false)
  })

  it('取消后的额度回滚失败 -> 仍显示已取消，并独立提示退款失败', () => {
    const view = toJobView(task({
      status: TASK_STATUS.FAILED,
      errorCode: 'TASK_CANCELLED',
      errorMessage: 'Task cancelled by user',
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: TASK_TYPE.VIDEO_PANEL,
        apiType: 'video',
        model: 'atlascloud::seedance-2.0-r2v',
        quantity: 1,
        unit: 'video',
        maxFrozenCost: 1.25,
        action: 'video.generate',
        status: 'failed',
      },
    }))

    expect(view.status).toBe('cancelled')
    expect(view.error).toBeNull()
    expect(view.refund).toEqual({ status: 'failed', amount: null })
    expect(view.billingStatus).toBe('failed')
  })

  it('任务完成但账务回滚 -> 不把完成状态覆盖成退款状态', () => {
    const view = toJobView(task({
      status: TASK_STATUS.COMPLETED,
      progress: 88,
      finishedAt: new Date('2026-08-08T10:00:40.000Z'),
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: TASK_TYPE.VIDEO_PANEL,
        apiType: 'video',
        model: 'video-model',
        quantity: 1,
        unit: 'video',
        maxFrozenCost: 2,
        action: 'video.generate',
        status: 'rolled_back',
      },
    }))

    expect(view.status).toBe('completed')
    expect(view.progress).toBe(100)
    expect(view.refund.status).toBe('refunded')
    expect(view.durationMs).toBe(30_000)
  })

  it('补偿失败 -> 显示失败退款且摘要没有原始任务字段', () => {
    const view = toJobView(task({
      status: TASK_STATUS.FAILED,
      errorCode: 'BILLING_COMPENSATION_FAILED',
      errorMessage: 'billing rollback failed',
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: TASK_TYPE.VIDEO_PANEL,
        apiType: 'video',
        model: 'video-model',
        quantity: 1,
        unit: 'video',
        maxFrozenCost: 2,
        action: 'video.generate',
        status: 'failed',
      },
    }))

    expect(view.status).toBe('failed')
    expect(view.refund.status).toBe('failed')
    expect(view).not.toHaveProperty('payload')
    expect(view).not.toHaveProperty('result')
    expect(view).not.toHaveProperty('externalId')
    expect(view).not.toHaveProperty('dedupeKey')
  })

  it('payload 有阶段说明 -> 只投影短 stageLabel 而不回传原始 payload', () => {
    const view = toJobView(task({
      payload: {
        stage: 'polling_provider',
        stageLabel: `等待供应商完成 ${'x'.repeat(200)}`,
        prompt: 'private prompt must not leave the server',
      },
    }))

    expect(view.stageLabel).toHaveLength(160)
    expect(view.stageLabel).toContain('等待供应商完成')
    expect(view).not.toHaveProperty('payload')
    expect(JSON.stringify(view)).not.toContain('private prompt must not leave the server')
  })

  it('只投影 batchRunId 供 response-lost reconciliation，不泄露完整 payload', () => {
    const view = toJobView(task({
      payload: {
        batchRunId: 'batch-123',
        prompt: 'private prompt must not leave the server',
      },
    }))

    expect(view.batchRunId).toBe('batch-123')
    expect(view).not.toHaveProperty('payload')
    expect(JSON.stringify(view)).not.toContain('private prompt must not leave the server')
  })
})
