import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type CreateTaskInput } from '@/lib/task/types'
import type { ApiError } from '@/lib/api-errors'

const prismaMock = vi.hoisted(() => ({
  task: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => ({
  rollbackTaskBilling: vi.fn(),
}))
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
}))
vi.mock('@/i18n/routing', () => ({
  locales: ['zh', 'en'],
}))

import { createTask } from '@/lib/task/service'

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-winner',
    userId: 'user-1',
    projectId: 'playground',
    episodeId: null,
    type: TASK_TYPE.CANVAS_TEXT,
    targetType: 'canvas-text',
    targetId: 'target-1',
    status: TASK_STATUS.QUEUED,
    progress: 0,
    attempt: 0,
    maxAttempts: 1,
    priority: 0,
    dedupeKey: 'canvas-text-r2v:key',
    externalId: null,
    payload: { idempotencyFingerprint: 'fingerprint-a', meta: { locale: 'zh' } },
    result: null,
    errorCode: null,
    errorMessage: null,
    billingInfo: null,
    billedAt: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    enqueuedAt: null,
    enqueueAttempts: 0,
    lastEnqueueError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function input(): CreateTaskInput {
  return {
    userId: 'user-1',
    projectId: 'playground',
    type: TASK_TYPE.CANVAS_TEXT,
    targetType: 'canvas-text',
    targetId: 'target-2',
    payload: { idempotencyFingerprint: 'fingerprint-a', meta: { locale: 'zh' } },
    dedupeKey: 'canvas-text-r2v:key',
    dedupeMode: 'idempotent',
    maxAttempts: 1,
  }
}

describe('createTask idempotent dedupe mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replays an existing terminal task instead of releasing its key', async () => {
    const completed = task({
      status: TASK_STATUS.COMPLETED,
      finishedAt: new Date(),
      result: { text: '完成描述' },
    })
    prismaMock.task.findFirst.mockResolvedValue(completed)

    const result = await createTask(input())

    expect(result).toEqual({ task: completed, deduped: true })
    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('uses the unique-key collision winner during overlapping submissions', async () => {
    const winner = task({ payload: input().payload })
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    prismaMock.task.create.mockRejectedValueOnce({ code: 'P2002' })

    const result = await createTask(input())

    expect(result).toEqual({ task: winner, deduped: true })
    expect(prismaMock.task.create).toHaveBeenCalledOnce()
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('[same idempotency key replays different payload] -> [rejects without create/update]', async () => {
    const winner = task({
      payload: { idempotencyFingerprint: 'fingerprint-original', meta: { locale: 'zh' } },
    })
    prismaMock.task.findFirst.mockResolvedValue(winner)

    await expect(createTask(input())).rejects.toMatchObject({
      code: 'CONFLICT',
      details: expect.objectContaining({ code: 'TASK_IDEMPOTENCY_CONFLICT' }),
    } satisfies Partial<ApiError>)

    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('[unique-key collision winner has different payload] -> [rejects the loser atomically]', async () => {
    const winner = task({
      payload: { idempotencyFingerprint: 'fingerprint-original', meta: { locale: 'zh' } },
    })
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    prismaMock.task.create.mockRejectedValueOnce({ code: 'P2002' })

    await expect(createTask(input())).rejects.toMatchObject({
      code: 'CONFLICT',
      details: expect.objectContaining({ code: 'TASK_IDEMPOTENCY_CONFLICT' }),
    } satisfies Partial<ApiError>)

    expect(prismaMock.task.create).toHaveBeenCalledOnce()
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('[terminal Canvas TTS provider request is replayed with the same idempotency key] -> [does not create a second provider task]', async () => {
    const terminalCanvas = task({
      type: TASK_TYPE.CANVAS_TTS,
      status: TASK_STATUS.FAILED,
      dedupeKey: 'canvas-tts:v1:request-a',
      externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-terminal',
      errorCode: 'VOICE_PROVIDER_TERMINAL_FAILED',
      payload: { idempotencyFingerprint: 'canvas-fingerprint-a', meta: { locale: 'zh' } },
    })
    prismaMock.task.findFirst.mockResolvedValueOnce(terminalCanvas)

    const result = await createTask({
      ...input(),
      type: TASK_TYPE.CANVAS_TTS,
      dedupeKey: 'canvas-tts:v1:request-a',
      payload: { idempotencyFingerprint: 'canvas-fingerprint-a', meta: { locale: 'zh' } },
    })

    expect(result).toEqual({ task: terminalCanvas, deduped: true })
    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('[user starts Canvas TTS with a new idempotency key after provider terminal] -> [creates one deliberate new logical task]', async () => {
    const created = task({
      id: 'task-new-canvas-attempt',
      type: TASK_TYPE.CANVAS_TTS,
      dedupeKey: 'canvas-tts:v1:request-b',
      payload: { idempotencyFingerprint: 'canvas-fingerprint-b', meta: { locale: 'zh' } },
    })
    prismaMock.task.findFirst.mockResolvedValueOnce(null)
    prismaMock.task.create.mockResolvedValueOnce(created)

    const result = await createTask({
      ...input(),
      type: TASK_TYPE.CANVAS_TTS,
      dedupeKey: 'canvas-tts:v1:request-b',
      payload: { idempotencyFingerprint: 'canvas-fingerprint-b', meta: { locale: 'zh' } },
    })

    expect(result).toEqual({ task: created, deduped: false })
    expect(prismaMock.task.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })
})
