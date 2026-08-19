import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => ({ rollbackTaskBilling: vi.fn() }))

import { assertIdempotentTaskBatchPreflight } from '@/lib/task/service'

describe('idempotent Task batch preflight', () => {
  beforeEach(() => vi.clearAllMocks())

  it('[all existing fingerprints match] -> [read-only preflight accepts the batch]', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-a', type: 'voice_line', status: 'completed', dedupeKey: null,
        externalId: null, errorCode: null,
        payload: { idempotencyFingerprint: 'fingerprint-a' },
      },
      {
        id: 'task-b', type: 'voice_line', status: 'completed', dedupeKey: null,
        externalId: null, errorCode: null,
        payload: { idempotencyFingerprint: 'fingerprint-b' },
      },
    ])

    await expect(assertIdempotentTaskBatchPreflight([
      { idempotencyTaskId: 'task-a', dedupeKey: 'line-a', payload: { idempotencyFingerprint: 'fingerprint-a' } },
      { idempotencyTaskId: 'task-b', dedupeKey: 'line-b', payload: { idempotencyFingerprint: 'fingerprint-b' } },
      { idempotencyTaskId: 'task-c', dedupeKey: 'line-c', payload: { idempotencyFingerprint: 'fingerprint-c' } },
    ])).resolves.toBeUndefined()

    expect(prismaMock.task.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { id: { in: ['task-a', 'task-b', 'task-c'] } },
          { dedupeKey: { in: ['line-a', 'line-b', 'line-c'] } },
        ],
      },
      select: {
        id: true,
        type: true,
        status: true,
        dedupeKey: true,
        externalId: true,
        errorCode: true,
        payload: true,
      },
    })
  })

  it('[one existing key has a different payload] -> [conflicts before callers submit any Task]', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-a', type: 'voice_line', status: 'completed', dedupeKey: null,
        externalId: null, errorCode: null,
        payload: { idempotencyFingerprint: 'fingerprint-old' },
      },
    ])

    await expect(assertIdempotentTaskBatchPreflight([
      { idempotencyTaskId: 'task-a', dedupeKey: 'line-a', payload: { idempotencyFingerprint: 'fingerprint-new' } },
      { idempotencyTaskId: 'task-b', dedupeKey: 'line-b', payload: { idempotencyFingerprint: 'fingerprint-b' } },
    ])).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      details: { code: 'TASK_IDEMPOTENCY_CONFLICT' },
    })
  })

  it('[request itself repeats a key with different fingerprints] -> [conflicts without a DB read]', async () => {
    await expect(assertIdempotentTaskBatchPreflight([
      { idempotencyTaskId: 'task-a', dedupeKey: 'line-a', payload: { idempotencyFingerprint: 'fingerprint-a' } },
      { idempotencyTaskId: 'task-a', dedupeKey: 'line-a', payload: { idempotencyFingerprint: 'fingerprint-b' } },
    ])).rejects.toMatchObject({
      details: { code: 'TASK_IDEMPOTENCY_CONFLICT' },
    })
    expect(prismaMock.task.findMany).not.toHaveBeenCalled()
  })

  it('[another HTTP identity already owns one active target] -> [rejects the whole batch before submit]', async () => {
    prismaMock.task.findMany.mockResolvedValue([{
      id: 'task-other',
      type: 'voice_line',
      status: 'processing',
      dedupeKey: 'line-b',
      externalId: null,
      errorCode: null,
      payload: { idempotencyFingerprint: 'other' },
    }])

    await expect(assertIdempotentTaskBatchPreflight([
      { idempotencyTaskId: 'task-a', dedupeKey: 'line-a', payload: { idempotencyFingerprint: 'fingerprint-a' } },
      { idempotencyTaskId: 'task-b', dedupeKey: 'line-b', payload: { idempotencyFingerprint: 'fingerprint-b' } },
    ])).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { code: 'VOICE_LINE_GENERATION_IN_PROGRESS' },
    })
  })
})
