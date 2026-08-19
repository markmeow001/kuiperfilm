import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { UnrecoverableError } from 'bullmq'
import { prepareTaskBilling } from '@/lib/billing/service'
import { buildDefaultTaskBillingInfo } from '@/lib/billing/task-policy'
import { cancelTask } from '@/lib/task/service'
import { withTaskLifecycle } from '@/lib/workers/shared'
import { TASK_TYPE, type TaskBillingInfo, type TaskJobData } from '@/lib/task/types'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createQueuedTask, createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

const ATLAS_AUDIO_MODEL = 'atlascloud::bytedance/seed-audio-1.0'
const PROVIDER_TEXT = '@audio1 hello'
const PROVIDER_CHARACTERS = [...PROVIDER_TEXT].length

vi.mock('@/lib/task/publisher', () => ({
  publishTaskEvent: vi.fn(async () => ({})),
}))

async function createPreparedVoiceTask() {
  process.env.BILLING_MODE = 'ENFORCE'
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  await seedBalance(user.id, 10)

  const taskId = randomUUID()
  const raw = buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, {
    audioModel: ATLAS_AUDIO_MODEL,
    providerText: PROVIDER_TEXT,
  })
  if (!raw || !raw.billable) {
    throw new Error('failed to build billing info fixture')
  }
  const prepared = await prepareTaskBilling({
    id: taskId,
    userId: user.id,
    projectId: project.id,
    billingInfo: raw,
  })

  const billingInfo = prepared as TaskBillingInfo
  await createQueuedTask({
    id: taskId,
    userId: user.id,
    projectId: project.id,
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'VoiceLine',
    targetId: 'line-1',
    billingInfo,
  })

  const jobData: TaskJobData = {
    taskId,
    type: TASK_TYPE.VOICE_LINE,
    locale: 'en',
    projectId: project.id,
    targetType: 'VoiceLine',
    targetId: 'line-1',
    billingInfo,
    userId: user.id,
    payload: {},
  }

  const job = {
    data: jobData,
    queueName: 'voice',
    opts: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 2_000,
      },
    },
    attemptsMade: 0,
  } as unknown as Job<TaskJobData>

  return { taskId, user, project, job }
}

describe('billing/worker lifecycle integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('settles billing and marks task completed on success', async () => {
    const fixture = await createPreparedVoiceTask()

    await withTaskLifecycle(fixture.job, async () => ({ actualCharacters: PROVIDER_CHARACTERS }))

    const task = await prisma.task.findUnique({ where: { id: fixture.taskId } })
    expect(task?.status).toBe('completed')
    const billing = task?.billingInfo as TaskBillingInfo
    expect(billing?.billable).toBe(true)
    expect((billing as Extract<TaskBillingInfo, { billable: true }>).status).toBe('settled')
  })

  it('rolls back billing and marks task failed on error', async () => {
    const fixture = await createPreparedVoiceTask()

    await expect(
      withTaskLifecycle(fixture.job, async () => {
        throw new Error('worker failed')
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError)

    const task = await prisma.task.findUnique({ where: { id: fixture.taskId } })
    expect(task?.status).toBe('failed')
    const billing = task?.billingInfo as TaskBillingInfo
    expect((billing as Extract<TaskBillingInfo, { billable: true }>).status).toBe('rolled_back')
  })

  it('keeps task active for queue retry on retryable worker error', async () => {
    const fixture = await createPreparedVoiceTask()

    await expect(
      withTaskLifecycle(fixture.job, async () => {
        throw new TypeError('terminated')
      }),
    ).rejects.toBeInstanceOf(TypeError)

    const task = await prisma.task.findUnique({ where: { id: fixture.taskId } })
    expect(task?.status).toBe('processing')
    const billing = task?.billingInfo as TaskBillingInfo
    expect((billing as Extract<TaskBillingInfo, { billable: true }>).status).toBe('frozen')
  })

  it('cancellation wins while the handler is in flight -> only cancellation rolls back billing', async () => {
    const fixture = await createPreparedVoiceTask()
    let signalStarted!: () => void
    let releaseHandler!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })

    const workerRun = withTaskLifecycle(fixture.job, async () => {
      signalStarted()
      await handlerGate
      return { actualCharacters: PROVIDER_CHARACTERS }
    })

    await started
    const cancellation = await cancelTask(fixture.taskId)
    releaseHandler()
    await workerRun

    const task = await prisma.task.findUnique({ where: { id: fixture.taskId } })
    const billing = task?.billingInfo as TaskBillingInfo
    expect(cancellation.cancelled).toBe(true)
    expect(task?.status).toBe('failed')
    expect(task?.errorCode).toBe('TASK_CANCELLED')
    expect((billing as Extract<TaskBillingInfo, { billable: true }>).status).toBe('rolled_back')
  })
})
