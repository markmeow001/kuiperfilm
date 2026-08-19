import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}))

const billingMock = vi.hoisted(() => ({
  rollbackTaskBilling: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async <T>(operation: () => Promise<T>) => await operation()),
}))
vi.mock('@/i18n/routing', () => ({ locales: ['zh', 'en'] }))

import { cancelTask, tryUpdateActiveTaskBillingInfo } from '@/lib/task/service'

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

describe('cancelTask terminal ownership', () => {
  let state: {
    id: string
    status: string
    type: string
    externalId: string | null
    billingInfo: TaskBillingInfo
    errorCode: string | null
    errorMessage: string | null
  }
  let order: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    order = []
    state = {
      id: 'task-1',
      status: TASK_STATUS.PROCESSING,
      type: TASK_TYPE.VOICE_LINE,
      externalId: null,
      billingInfo: { ...frozenBilling },
      errorCode: null,
      errorMessage: null,
    }

    prismaMock.task.findUnique.mockImplementation(async () => ({ ...state }))
    prismaMock.task.updateMany.mockImplementation(async ({ data }: {
      data: { status?: string; errorCode?: string; errorMessage?: string }
    }) => {
      order.push('claim')
      if (state.status !== TASK_STATUS.QUEUED && state.status !== TASK_STATUS.PROCESSING) {
        return { count: 0 }
      }
      state = {
        ...state,
        status: data.status || state.status,
        errorCode: data.errorCode || state.errorCode,
        errorMessage: data.errorMessage || state.errorMessage,
      }
      return { count: 1 }
    })
    prismaMock.task.update.mockImplementation(async ({ data }: {
      data: { billingInfo?: TaskBillingInfo }
    }) => {
      state = {
        ...state,
        ...(data.billingInfo ? { billingInfo: data.billingInfo } : {}),
      }
      return { ...state }
    })
    billingMock.rollbackTaskBilling.mockImplementation(async () => {
      order.push('rollback')
      return { ...frozenBilling, status: 'rolled_back' as const }
    })
  })

  it('claims TASK_CANCELLED before rolling back the reservation', async () => {
    const result = await cancelTask('task-1')

    expect(result.cancelled).toBe(true)
    expect(order).toEqual(['claim', 'rollback'])
    expect(billingMock.rollbackTaskBilling).toHaveBeenCalledTimes(1)
    expect(result.task).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'TASK_CANCELLED',
      billingInfo: { status: 'rolled_back' },
    })
  })

  it('loses the terminal CAS to completion -> does not roll back billing', async () => {
    prismaMock.task.updateMany.mockImplementationOnce(async () => {
      order.push('claim')
      state = { ...state, status: TASK_STATUS.COMPLETED }
      return { count: 0 }
    })

    const result = await cancelTask('task-1')

    expect(result.cancelled).toBe(false)
    expect(order).toEqual(['claim'])
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
    expect(result.task).toMatchObject({ status: TASK_STATUS.COMPLETED })
  })

  it.each([
    'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-1',
    'FAL:VOICE:CLAIM:claim-1:owner-1',
    'malformed-paid-handoff',
  ])('protects a nonempty VoiceLine provider handoff %s from cancel and refund', async (externalId) => {
    state = { ...state, externalId }

    const result = await cancelTask('task-1')

    expect(result.cancelled).toBe(false)
    expect(result.providerHandoffProtected).toBe(true)
    expect(state.status).toBe(TASK_STATUS.PROCESSING)
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('loses the null-externalId cancellation CAS to a concurrent provider claim -> protects the handoff', async () => {
    prismaMock.task.updateMany.mockImplementationOnce(async () => {
      order.push('claim')
      state = { ...state, externalId: 'FAL:VOICE:CLAIM:claim-1:owner-1' }
      return { count: 0 }
    })

    const result = await cancelTask('task-1')

    expect(result.cancelled).toBe(false)
    expect(result.providerHandoffProtected).toBe(true)
    expect(state.status).toBe(TASK_STATUS.PROCESSING)
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('rollback failure keeps cancellation as the primary lifecycle result', async () => {
    billingMock.rollbackTaskBilling.mockImplementationOnce(async () => {
      order.push('rollback')
      return { ...frozenBilling, status: 'failed' as const }
    })

    const result = await cancelTask('task-1')

    expect(result.cancelled).toBe(true)
    expect(result.task).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'TASK_CANCELLED',
      billingInfo: { status: 'failed' },
    })
  })

  it('reloads the billing snapshot after winning cancellation so a concurrent freeze is refunded', async () => {
    const quotedBilling: Extract<TaskBillingInfo, { billable: true }> = {
      ...frozenBilling,
      freezeId: null,
      status: 'quoted',
    }
    state = { ...state, billingInfo: quotedBilling }
    prismaMock.task.updateMany.mockImplementationOnce(async ({ data }: {
      data: { status?: string; errorCode?: string; errorMessage?: string }
    }) => {
      order.push('claim')
      // The submitter created and persisted the freeze after cancelTask read
      // its first snapshot, but before cancellation won the lifecycle CAS.
      state = {
        ...state,
        billingInfo: { ...frozenBilling },
        status: data.status || state.status,
        errorCode: data.errorCode || state.errorCode,
        errorMessage: data.errorMessage || state.errorMessage,
      }
      return { count: 1 }
    })

    const result = await cancelTask('task-1')

    expect(result.cancelled).toBe(true)
    expect(billingMock.rollbackTaskBilling).toHaveBeenCalledWith({
      id: 'task-1',
      billingInfo: expect.objectContaining({ freezeId: 'freeze-1', status: 'frozen' }),
    })
    expect(result.task).toMatchObject({
      errorCode: 'TASK_CANCELLED',
      billingInfo: { status: 'rolled_back' },
    })
  })

  it('stores a prepared billing snapshot only while the task is active', async () => {
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 1 })

    await expect(
      tryUpdateActiveTaskBillingInfo('task-1', frozenBilling),
    ).resolves.toBe(true)

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
      data: { billingInfo: frozenBilling },
    })
  })
})
