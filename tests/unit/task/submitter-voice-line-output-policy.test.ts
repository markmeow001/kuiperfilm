import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

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
const runRuntimeMock = vi.hoisted(() => ({
  attachTaskToRun: vi.fn(),
  createRun: vi.fn(),
}))
const publishMock = vi.hoisted(() => vi.fn())
const mediaPrismaMock = vi.hoisted(() => ({
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
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
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))
vi.mock('@/lib/llm-observe/stage-pipeline', () => ({
  getTaskFlowMeta: vi.fn(() => ({
    flowId: 'test-flow',
    flowStageTitle: 'Test',
    flowStageIndex: 1,
    flowStageTotal: 1,
  })),
}))
vi.mock('@/lib/run-runtime/service', () => runRuntimeMock)
vi.mock('@/lib/run-runtime/workflow', () => ({
  isAiTaskType: vi.fn(() => false),
  workflowTypeFromTaskType: vi.fn(() => 'test'),
}))
vi.mock('@/lib/task/rate-limit', () => ({ enforceRateLimit: vi.fn() }))
vi.mock('@/lib/task/episode-conflict-guard', () => ({ assertNoEpisodeConflict: vi.fn() }))
vi.mock('@/lib/skills/server', () => ({ loadSkillConfigById: vi.fn() }))
vi.mock('@/lib/skills/constraints', () => ({ enforceConstraints: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: mediaPrismaMock }))
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

import { submitTask } from '@/lib/task/submitter'

const TASK_OUTPUT = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`

function submission(payload: Record<string, unknown>) {
  return {
    userId: 'user-a',
    locale: 'en' as const,
    projectId: 'project-a',
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'VoiceLine',
    targetId: 'line-a',
    payload,
  }
}

function mediaRow(publicId: string) {
  return {
    id: `media-${publicId}`,
    publicId,
    storageKey: TASK_OUTPUT,
    sha256: null,
    mimeType: 'audio/wav',
    sizeBytes: null,
    width: null,
    height: null,
    durationMs: null,
    updatedAt: new Date('2026-08-12T00:00:00.000Z'),
    uploadedByUserId: null,
  }
}

describe('submitTask VoiceLine task-output payload boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BILLING_MODE = 'OFF'
    serviceMock.createTask.mockResolvedValue({
      task: {
        id: 'task-a',
        status: 'queued',
        payload: {},
        billingInfo: null,
        priority: 0,
        maxAttempts: 5,
      },
      deduped: false,
    })
    serviceMock.markTaskEnqueued.mockResolvedValue({})
    queueMock.addTaskJob.mockResolvedValue({ id: 'task-a' })
    billingMock.isBillableTaskType.mockReturnValue(false)
    billingMock.buildDefaultTaskBillingInfo.mockReturnValue(null)
    billingMock.prepareTaskBilling.mockResolvedValue(null)
    publishMock.mockResolvedValue({})
    mediaPrismaMock.mediaObject.findUnique.mockImplementation(async (args: unknown) => {
      const publicId = (args as { where?: { publicId?: unknown } }).where?.publicId
      return publicId === 'reserved-audio' ? mediaRow('reserved-audio') : null
    })
  })

  it.each([
    ['raw task output', TASK_OUTPUT],
    ['signed task output URL', `https://cos.example/${TASK_OUTPUT}?sign=temporary`],
    ['absolute /m alias', 'https://app.example/m/reserved-audio?download=1'],
    ['protocol-relative /m alias', '//app.example/m/reserved-audio#player'],
  ])('[nested %s] -> [rejects before Task, queue, billing, run, or media mutation]', async (_label, reference) => {
    await expect(
      submitTask(submission({ graph: { nodes: [{ data: { audio: reference } }] } })),
    ).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: { code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN' },
    })

    expect(serviceMock.createTask).not.toHaveBeenCalled()
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
    expect(billingMock.isBillableTaskType).not.toHaveBeenCalled()
    expect(billingMock.buildDefaultTaskBillingInfo).not.toHaveBeenCalled()
    expect(billingMock.prepareTaskBilling).not.toHaveBeenCalled()
    expect(runRuntimeMock.createRun).not.toHaveBeenCalled()
    expect(runRuntimeMock.attachTaskToRun).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
    expect(mediaPrismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(mediaPrismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('[ordinary nested payload and missing /m text] -> [creates and enqueues with normalized payload intact]', async () => {
    const payload = {
      graph: { nodes: [{ data: { audio: null, note: 'ordinary', unavailable: '/m/missing' } }] },
    }

    await expect(submitTask(submission(payload))).resolves.toMatchObject({
      success: true,
      taskId: 'task-a',
      status: 'queued',
    })

    expect(serviceMock.createTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        graph: payload.graph,
        meta: expect.objectContaining({ locale: 'en' }),
      }),
    }))
    expect(queueMock.addTaskJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          graph: payload.graph,
          meta: expect.objectContaining({ locale: 'en' }),
        }),
      }),
      { priority: 0, attempts: 5 },
    )
    expect(billingMock.isBillableTaskType).toHaveBeenCalledWith(TASK_TYPE.VOICE_LINE)
    expect(billingMock.prepareTaskBilling).not.toHaveBeenCalled()
    expect(mediaPrismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(mediaPrismaMock.mediaObject.update).not.toHaveBeenCalled()
  })
})
