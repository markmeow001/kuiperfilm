import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@/lib/api-errors'
import { buildDefaultTaskBillingInfo } from '@/lib/billing/task-policy'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestUser, seedBalance } from '../../helpers/billing-fixtures'

const taskQueueMock = vi.hoisted(() => ({
  addTaskJob: vi.fn(async (..._args: unknown[]) => ({ id: 'mock-job' })),
}))

vi.mock('@/lib/task/queues', () => ({
  addTaskJob: taskQueueMock.addTaskJob,
}))

vi.mock('@/lib/task/publisher', () => ({
  publishTaskEvent: vi.fn(async () => ({})),
}))

const VOICE_PAYLOAD = {
  audioModel: 'atlascloud::bytedance/seed-audio-1.0',
  providerText: '@audio1 hello',
} as const

describe('billing/submitter integration', () => {
  beforeEach(async () => {
    await resetBillingState()
    taskQueueMock.addTaskJob.mockReset()
    taskQueueMock.addTaskJob.mockResolvedValue({ id: 'mock-job' })
    process.env.BILLING_MODE = 'ENFORCE'
  })

  it('builds billing info server-side for billable task submission', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    const result = await submitTask({
      userId: user.id,
      locale: 'en',
      projectId: 'project-a',
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'VoiceLine',
      targetId: 'line-a',
      payload: VOICE_PAYLOAD,
    })

    expect(result.success).toBe(true)
    const task = await prisma.task.findUnique({ where: { id: result.taskId } })
    expect(task).toBeTruthy()
    const billing = task?.billingInfo as { billable?: boolean; source?: string } | null
    expect(billing?.billable).toBe(true)
    expect(billing?.source).toBe('task')
  })

  it('marks task as failed when balance is insufficient', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 0)

    const billingInfo = buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, VOICE_PAYLOAD)
    expect(billingInfo?.billable).toBe(true)

    await expect(
      submitTask({
        userId: user.id,
        locale: 'en',
        projectId: 'project-b',
        type: TASK_TYPE.VOICE_LINE,
        targetType: 'VoiceLine',
        targetId: 'line-b',
        payload: VOICE_PAYLOAD,
        billingInfo,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' } satisfies Pick<ApiError, 'code'>)

    const task = await prisma.task.findFirst({
      where: {
        userId: user.id,
        type: TASK_TYPE.VOICE_LINE,
      },
      orderBy: { createdAt: 'desc' },
    })

    expect(task).toBeTruthy()
    expect(task?.status).toBe('failed')
    expect(task?.errorCode).toBe('INSUFFICIENT_BALANCE')
  })

  it('forwards an explicit maxAttempts value to the BullMQ job without changing its priority', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    await submitTask({
      userId: user.id,
      locale: 'zh',
      projectId: 'project-queue-attempts',
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'VoiceLine',
      targetId: 'line-queue-attempts',
      payload: VOICE_PAYLOAD,
      maxAttempts: 1,
    })

    expect(taskQueueMock.addTaskJob).toHaveBeenCalledOnce()
    expect(taskQueueMock.addTaskJob.mock.calls[0]?.[1]).toEqual({
      priority: 0,
      attempts: 1,
    })
  })

  it('concurrent idempotent submissions reuse one task, billing attempt, and queue job', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    let releaseQueue!: () => void
    taskQueueMock.addTaskJob.mockImplementationOnce(
      async () => await new Promise<{ id: string }>((resolve) => {
        releaseQueue = () => resolve({ id: 'mock-job' })
      }),
    )

    const submission = {
      userId: user.id,
      locale: 'en' as const,
      projectId: 'project-idempotent',
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'VoiceLine',
      targetId: 'line-idempotent',
      payload: VOICE_PAYLOAD,
      dedupeKey: `voice-idempotent:${user.id}`,
      dedupeMode: 'idempotent' as const,
      maxAttempts: 1,
    }

    const firstPromise = submitTask(submission)
    await vi.waitFor(() => {
      expect(taskQueueMock.addTaskJob).toHaveBeenCalledOnce()
    })

    const second = await submitTask(submission)
    releaseQueue()
    const first = await firstPromise

    expect(second.taskId).toBe(first.taskId)
    expect(second.deduped).toBe(true)
    expect(first.deduped).toBe(false)
    expect(taskQueueMock.addTaskJob).toHaveBeenCalledOnce()
    expect(await prisma.task.count({
      where: { dedupeKey: submission.dedupeKey },
    })).toBe(1)
  })
})
