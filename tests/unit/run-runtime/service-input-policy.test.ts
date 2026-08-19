import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  graphRun: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  graphStep: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  graphStepAttempt: { upsert: vi.fn() },
  graphEvent: { create: vi.fn(), findMany: vi.fn() },
  graphCheckpoint: { create: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  task: {
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({
  extractCOSKey: (value: string | null | undefined) => {
    if (!value) return null
    const normalized = value.trim()
    if (/^https?:\/\//i.test(normalized)) {
      return decodeURIComponent(new URL(normalized).pathname).replace(/^\/+/, '')
    }
    return normalized.replace(/^\/+/, '')
  },
  getSignedUrl: (key: string) => `/signed/${encodeURIComponent(key)}`,
}))

import { createRun } from '@/lib/run-runtime/service'

const TASK_OUTPUT = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`

function runInput(input: Record<string, unknown> | null) {
  return {
    userId: 'user-a',
    projectId: 'project-a',
    episodeId: 'episode-a',
    workflowType: 'video',
    taskType: 'video_generate',
    taskId: 'task-a',
    targetType: 'episode',
    targetId: 'episode-a',
    input,
  }
}

function runRow(input: Record<string, unknown> | null) {
  return {
    id: 'run-a',
    ...runInput(input),
    status: 'queued',
    output: null,
    errorCode: null,
    errorMessage: null,
    cancelRequestedAt: null,
    queuedAt: new Date('2026-08-12T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    lastSeq: 0,
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    updatedAt: new Date('2026-08-12T00:00:00.000Z'),
  }
}

describe('GraphRun input VoiceLine task-output write policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('[GraphRun.input contains a deeply nested signed reserved output] -> [rejects before GraphRun, media, or Task writes]', async () => {
    const input = {
      graph: { nodes: [{ data: { audio: `https://cos.example/${TASK_OUTPUT}?sign=temp` } }] },
    }

    await expect(createRun(runInput(input))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: { code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN' },
    })
    expect(prismaMock.graphRun.create).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.upsert).not.toHaveBeenCalled()
  })

  it('[GraphRun.input contains null, ordinary values, and a missing /m alias] -> [persists the input unchanged]', async () => {
    const input = { audio: null, note: 'ordinary', unavailable: '/m/missing-audio' }
    prismaMock.mediaObject.findUnique.mockResolvedValue(null)
    prismaMock.graphRun.create.mockResolvedValue(runRow(input))

    const result = await createRun(runInput(input))

    expect(prismaMock.graphRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ input }),
    })
    expect(result.input).toEqual(input)
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.upsert).not.toHaveBeenCalled()
  })
})
