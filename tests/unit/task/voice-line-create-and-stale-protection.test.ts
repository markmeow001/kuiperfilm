import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type CreateTaskInput, type TaskBillingInfo } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}))
const billingMock = vi.hoisted(() => ({ rollbackTaskBilling: vi.fn() }))
const recoveryMock = vi.hoisted(() => ({
  recoverMissingVoiceLineJob: vi.fn(),
}))
const recoveryPolicyMock = vi.hoisted(() => ({
  isProtectedVoiceLineProviderHandoff: vi.fn(),
  isPaidVoiceProviderTaskType: vi.fn(),
  isSafelyTerminalPaidVoiceProviderFailure: vi.fn(),
}))
const reconcileMock = vi.hoisted(() => ({ isJobAlive: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async <T>(operation: () => Promise<T>) => await operation()),
}))
vi.mock('@/i18n/routing', () => ({ locales: ['zh', 'en'] }))
vi.mock('@/lib/task/reconcile', () => reconcileMock)
vi.mock('@/lib/task/voice-line-job-recovery', () => recoveryMock)
vi.mock('@/lib/task/voice-line-recovery-policy', () => recoveryPolicyMock)

import { createTask, sweepStaleTasks } from '@/lib/task/service'

const billingInfo: Extract<TaskBillingInfo, { billable: true }> = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.VOICE_LINE,
  apiType: 'voice',
  model: 'voice-model',
  quantity: 8,
  unit: 'second',
  maxFrozenCost: 1,
  action: 'voice.generate',
  freezeId: 'freeze-1',
  modeSnapshot: 'ENFORCE',
  status: 'frozen',
}

function activeVoiceTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-existing',
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'NovelPromotionVoiceLine',
    targetId: 'line-1',
    status: TASK_STATUS.PROCESSING,
    progress: 30,
    attempt: 1,
    maxAttempts: 5,
    priority: 0,
    dedupeKey: 'voice_line:line-1',
    externalId: 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-1',
    payload: {
      episodeId: 'episode-1',
      lineId: 'line-1',
      sourceFingerprint: 'a'.repeat(64),
      audioModel: 'voice-model',
      meta: { locale: 'zh' },
    },
    billingInfo,
    heartbeatAt: new Date(0),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

function createInput(): CreateTaskInput {
  return {
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'NovelPromotionVoiceLine',
    targetId: 'line-1',
    payload: {
      episodeId: 'episode-1',
      lineId: 'line-1',
      sourceFingerprint: 'a'.repeat(64),
      audioModel: 'voice-model',
      meta: { locale: 'zh' },
    },
    dedupeKey: 'voice_line:line-1',
    billingInfo,
  }
}

describe('VoiceLine active dedupe queue-loss recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.task.findUnique.mockResolvedValue({ billingInfo })
    prismaMock.task.update.mockResolvedValue({})
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.task.create.mockResolvedValue({ id: 'task-new', status: TASK_STATUS.QUEUED })
    billingMock.rollbackTaskBilling.mockResolvedValue({ ...billingInfo, status: 'rolled_back' })
    reconcileMock.isJobAlive.mockResolvedValue(false)
    recoveryPolicyMock.isProtectedVoiceLineProviderHandoff.mockImplementation(
      (task: { type?: unknown; externalId?: unknown }) => (
        task.type === TASK_TYPE.VOICE_LINE
        && typeof task.externalId === 'string'
        && task.externalId.trim().length > 0
      ),
    )
    recoveryPolicyMock.isPaidVoiceProviderTaskType.mockImplementation(
      (type: string) => type === TASK_TYPE.VOICE_LINE || type === TASK_TYPE.CANVAS_TTS,
    )
    recoveryPolicyMock.isSafelyTerminalPaidVoiceProviderFailure.mockImplementation(
      (task: { type?: unknown; status?: unknown; externalId?: unknown; errorCode?: unknown }) => (
        task.type === TASK_TYPE.VOICE_LINE
        && task.status === TASK_STATUS.FAILED
        && typeof task.externalId === 'string'
        && task.externalId.startsWith('ATLASCLOUD:AUDIO:')
        && !task.externalId.startsWith('ATLASCLOUD:AUDIO:CLAIM:')
        && (task.errorCode === 'VOICE_PROVIDER_TERMINAL_FAILED'
          || task.errorCode === 'VOICE_PROVIDER_TERMINAL_TIMEOUT')
      ),
    )
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValue({
      protected: true,
      state: 'requeued',
    })
  })

  it('[existing active task lost its job but has actual provider id] -> [reuse it; 0 fail/refund/create]', async () => {
    const existing = activeVoiceTask()
    prismaMock.task.findFirst.mockResolvedValueOnce(existing)

    await expect(createTask(createInput())).resolves.toEqual({
      task: existing,
      deduped: true,
    })

    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(existing)
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[requeue acknowledgement is unknown] -> [still reuse protected task; 0 replacement]', async () => {
    const existing = activeVoiceTask()
    prismaMock.task.findFirst.mockResolvedValueOnce(existing)
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: true,
      state: 'deferred',
    })

    await expect(createTask(createInput())).resolves.toEqual({ task: existing, deduped: true })

    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[provider claim/malformed handoff] -> [quarantine even when payload locale is unusable]', async () => {
    const existing = activeVoiceTask({
      externalId: 'FAL:VOICE:CLAIM:123:owner',
      payload: {},
    })
    prismaMock.task.findFirst.mockResolvedValueOnce(existing)
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: true,
      state: 'quarantined',
    })

    await expect(createTask(createInput())).resolves.toEqual({ task: existing, deduped: true })

    expect(reconcileMock.isJobAlive).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[failed terminal BullMQ probe + durable CLAIM] -> [keeps dedupe and blocks a second Task/provider submit]', async () => {
    const existing = activeVoiceTask({ externalId: 'FAL:VOICE:CLAIM:123:owner' })
    prismaMock.task.findFirst.mockResolvedValueOnce(existing)
    recoveryMock.recoverMissingVoiceLineJob.mockResolvedValueOnce({
      protected: true,
      state: 'quarantined',
    })

    await expect(createTask(createInput())).resolves.toEqual({ task: existing, deduped: true })

    expect(reconcileMock.isJobAlive).toHaveBeenCalledWith(existing.id)
    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(existing)
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it.each([
    'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-1',
    'FAL:VOICE:CLAIM:123:owner',
    'malformed-paid-handoff',
  ])('[terminal DB task with protected handoff %s] -> [keeps dedupe and blocks a replacement]', async (externalId) => {
    const existing = activeVoiceTask({
      status: TASK_STATUS.FAILED,
      externalId,
    })
    prismaMock.task.findFirst.mockResolvedValueOnce(existing)

    await expect(createTask(createInput())).resolves.toEqual({ task: existing, deduped: true })

    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[completed VoiceLine with a published provider id] -> [releases the old dedupe for a deliberate regeneration]', async () => {
    const completed = activeVoiceTask({
      status: TASK_STATUS.COMPLETED,
      externalId: 'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-completed',
    })
    const created = { id: 'task-new', status: TASK_STATUS.QUEUED }
    prismaMock.task.findFirst.mockResolvedValueOnce(completed)
    prismaMock.task.create.mockResolvedValueOnce(created)

    await expect(createTask(createInput())).resolves.toEqual({ task: created, deduped: false })

    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: completed.id },
      data: { dedupeKey: null },
    })
    expect(prismaMock.task.create).toHaveBeenCalledOnce()
  })

  it.each([
    'VOICE_PROVIDER_TERMINAL_FAILED',
    'VOICE_PROVIDER_TERMINAL_TIMEOUT',
  ])('[old VoiceLine has explicit provider terminal marker %s] -> [a deliberate generate request creates a new logical task]', async (errorCode) => {
    const terminal = activeVoiceTask({
      status: TASK_STATUS.FAILED,
      externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-terminal',
      errorCode,
    })
    const created = { id: 'task-new', status: TASK_STATUS.QUEUED }
    prismaMock.task.findFirst.mockResolvedValueOnce(terminal)

    await expect(createTask(createInput())).resolves.toEqual({ task: created, deduped: false })

    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: terminal.id },
      data: { dedupeKey: null },
    })
    expect(prismaMock.task.create).toHaveBeenCalledOnce()
    expect(recoveryMock.recoverMissingVoiceLineJob).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[old VoiceLine has actual provider id but only ambiguous transport error] -> [same dedupe remains blocked with zero second task]', async () => {
    const ambiguous = activeVoiceTask({
      status: TASK_STATUS.FAILED,
      externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-ambiguous',
      errorCode: 'EXTERNAL_ERROR',
    })
    prismaMock.task.findFirst.mockResolvedValueOnce(ambiguous)

    await expect(createTask(createInput())).resolves.toEqual({ task: ambiguous, deduped: true })

    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[same HTTP UUID is replayed after its VoiceLine Task completed] -> [returns the immutable historical Task without touching the active target lock]', async () => {
    const completed = activeVoiceTask({
      id: 'voice-request-task-a',
      status: TASK_STATUS.COMPLETED,
      dedupeKey: null,
      payload: {
        ...createInput().payload,
        idempotencyFingerprint: 'fingerprint-request-a',
      },
    })
    prismaMock.task.findUnique.mockResolvedValueOnce(completed)

    await expect(createTask({
      ...createInput(),
      idempotencyTaskId: 'voice-request-task-a',
      dedupeKey: 'voice_line:line-1',
      payload: completed.payload,
    })).resolves.toEqual({ task: completed, deduped: true })

    expect(prismaMock.task.findUnique).toHaveBeenCalledWith({
      where: { id: 'voice-request-task-a' },
    })
    expect(prismaMock.task.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('[new HTTP UUID follows a terminal VoiceLine attempt] -> [releases only the target lock and creates the new immutable Task id]', async () => {
    const terminal = activeVoiceTask({
      id: 'voice-request-task-a',
      status: TASK_STATUS.COMPLETED,
      dedupeKey: 'voice_line:line-1',
    })
    const created = activeVoiceTask({
      id: 'voice-request-task-b',
      status: TASK_STATUS.QUEUED,
      dedupeKey: 'voice_line:line-1',
    })
    prismaMock.task.findUnique.mockResolvedValueOnce(null)
    prismaMock.task.findFirst.mockResolvedValueOnce(terminal)
    prismaMock.task.create.mockResolvedValueOnce(created)

    await expect(createTask({
      ...createInput(),
      idempotencyTaskId: 'voice-request-task-b',
      dedupeKey: 'voice_line:line-1',
    })).resolves.toEqual({ task: created, deduped: false })

    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: terminal.id },
      data: { dedupeKey: null },
    })
    expect(prismaMock.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'voice-request-task-b',
        dedupeKey: 'voice_line:line-1',
      }),
    })
  })

  it('[two different HTTP UUIDs race for one active VoiceLine] -> [P2002 loser gets a deterministic 409 after first checking its exact id]', async () => {
    const winner = activeVoiceTask({
      id: 'voice-request-task-a',
      dedupeKey: 'voice_line:line-1',
    })
    prismaMock.task.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    prismaMock.task.create.mockRejectedValueOnce({ code: 'P2002' })
    reconcileMock.isJobAlive.mockResolvedValueOnce(true)

    await expect(createTask({
      ...createInput(),
      idempotencyTaskId: 'voice-request-task-b',
      dedupeKey: 'voice_line:line-1',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { code: 'VOICE_LINE_GENERATION_IN_PROGRESS' },
    })

    expect(prismaMock.task.findUnique.mock.calls.map(([query]) => query)).toEqual([
      { where: { id: 'voice-request-task-b' } },
      { where: { id: 'voice-request-task-b' } },
    ])
    expect(reconcileMock.isJobAlive).toHaveBeenCalledWith(winner.id)
    expect(prismaMock.task.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('[different HTTP UUID sees an already-active VoiceLine before create] -> [409 with zero second Task creation]', async () => {
    const winner = activeVoiceTask({
      id: 'voice-request-task-a',
      dedupeKey: 'voice_line:line-1',
    })
    prismaMock.task.findUnique.mockResolvedValueOnce(null)
    prismaMock.task.findFirst.mockResolvedValueOnce(winner)
    reconcileMock.isJobAlive.mockResolvedValueOnce(true)

    await expect(createTask({
      ...createInput(),
      idempotencyTaskId: 'voice-request-task-b',
      dedupeKey: 'voice_line:line-1',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { code: 'VOICE_LINE_GENERATION_IN_PROGRESS' },
    })

    expect(reconcileMock.isJobAlive).toHaveBeenCalledWith(winner.id)
    expect(prismaMock.task.create).not.toHaveBeenCalled()
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('[same HTTP UUID races and loses create acknowledgement] -> [P2002 exact-id reread returns its Task regardless terminal state]', async () => {
    const committed = activeVoiceTask({
      id: 'voice-request-task-a',
      status: TASK_STATUS.COMPLETED,
      dedupeKey: null,
      payload: {
        ...createInput().payload,
        idempotencyFingerprint: 'fingerprint-request-a',
      },
    })
    prismaMock.task.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(committed)
    prismaMock.task.findFirst.mockResolvedValueOnce(null)
    prismaMock.task.create.mockRejectedValueOnce({ code: 'P2002' })

    await expect(createTask({
      ...createInput(),
      idempotencyTaskId: committed.id,
      dedupeKey: 'voice_line:line-1',
      payload: committed.payload,
    })).resolves.toEqual({ task: committed, deduped: true })

    expect(prismaMock.task.findFirst).toHaveBeenCalledTimes(1)
    expect(prismaMock.task.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('[P2002 matches neither immutable id nor target admission key] -> [does not swallow the unknown database conflict]', async () => {
    const p2002 = { code: 'P2002', meta: { target: 'unexpected_unique_key' } }
    prismaMock.task.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    prismaMock.task.create.mockRejectedValueOnce(p2002)

    await expect(createTask({
      ...createInput(),
      idempotencyTaskId: 'voice-request-task-a',
      dedupeKey: 'voice_line:line-1',
    })).rejects.toBe(p2002)

    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('[queue probe saw no handoff, provider claim wins before orphan CAS] -> [reuses authoritative task; 0 refund/create]', async () => {
    const staleSnapshot = activeVoiceTask({ externalId: null })
    const claimed = activeVoiceTask({ externalId: 'FAL:VOICE:CLAIM:race:owner' })
    prismaMock.task.findFirst
      .mockResolvedValueOnce(staleSnapshot)
      .mockResolvedValueOnce(claimed)
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(createTask(createInput())).resolves.toEqual({ task: claimed, deduped: true })

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [{ externalId: null }, { externalId: '' }] }],
      }),
    }))
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('[missing locale snapshot had no handoff, provider claim wins failure CAS] -> [reuses authoritative task]', async () => {
    const staleSnapshot = activeVoiceTask({ externalId: null, payload: {} })
    const claimed = activeVoiceTask({
      externalId: 'FAL:VOICE:CLAIM:locale-race:owner',
      payload: {},
    })
    prismaMock.task.findFirst
      .mockResolvedValueOnce(staleSnapshot)
      .mockResolvedValueOnce(claimed)
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(createTask(createInput())).resolves.toEqual({ task: claimed, deduped: true })

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [{ externalId: null }, { externalId: '' }] }],
      }),
    }))
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('[P2002 winner has durable provider handoff and missing job] -> [reuse winner; 0 second create]', async () => {
    const winner = activeVoiceTask({ id: 'task-winner' })
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    prismaMock.task.create.mockRejectedValueOnce({ code: 'P2002' })

    await expect(createTask(createInput())).resolves.toEqual({ task: winner, deduped: true })

    expect(prismaMock.task.create).toHaveBeenCalledOnce()
    expect(recoveryMock.recoverMissingVoiceLineJob).toHaveBeenCalledWith(winner)
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[P2002 probe saw empty handoff, provider claim wins orphan CAS] -> [keeps winner dedupe and blocks second create]', async () => {
    const staleWinner = activeVoiceTask({ id: 'task-winner', externalId: null })
    const claimedWinner = activeVoiceTask({
      id: 'task-winner',
      externalId: 'FAL:VOICE:CLAIM:race:owner',
    })
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(staleWinner)
      .mockResolvedValueOnce(claimedWinner)
    prismaMock.task.create.mockRejectedValueOnce({ code: 'P2002' })
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(createTask(createInput())).resolves.toEqual({ task: claimedWinner, deduped: true })

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [{ externalId: null }, { externalId: '' }] }],
      }),
    }))
    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.create).toHaveBeenCalledOnce()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[P2002 missing-locale winner gains provider claim before failure CAS] -> [keeps winner dedupe]', async () => {
    const staleWinner = activeVoiceTask({ id: 'task-winner', externalId: null, payload: {} })
    const claimedWinner = activeVoiceTask({
      id: 'task-winner',
      externalId: 'FAL:VOICE:CLAIM:locale-race:owner',
      payload: {},
    })
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(staleWinner)
      .mockResolvedValueOnce(claimedWinner)
    prismaMock.task.create.mockRejectedValueOnce({ code: 'P2002' })
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(createTask(createInput())).resolves.toEqual({ task: claimedWinner, deduped: true })

    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.create).toHaveBeenCalledOnce()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })

  it('[stale snapshot had no handoff, provider claim wins timeout CAS] -> [0 timeout/refund]', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([activeVoiceTask({ externalId: null })])
    prismaMock.task.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(sweepStaleTasks({ processingThresholdMs: 60_000 })).resolves.toEqual([])

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            AND: expect.arrayContaining([
              { OR: [{ externalId: null }, { externalId: '' }] },
            ]),
          }),
        ]),
      }),
    }))
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })
})

describe('VoiceLine stale heartbeat protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findUnique.mockResolvedValue({ billingInfo })
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    billingMock.rollbackTaskBilling.mockResolvedValue({ ...billingInfo, status: 'rolled_back' })
    recoveryPolicyMock.isProtectedVoiceLineProviderHandoff.mockReturnValue(true)
  })

  it.each([
    'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-1',
    'FAL:VOICE:CLAIM:123:owner',
    'malformed-paid-handoff',
  ])('[stale processing handoff %s] -> [0 timeout CAS and 0 refund]', async (externalId) => {
    prismaMock.task.findMany.mockResolvedValueOnce([activeVoiceTask({ externalId })])

    await expect(sweepStaleTasks({ processingThresholdMs: 60_000 })).resolves.toEqual([])

    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    expect(billingMock.rollbackTaskBilling).not.toHaveBeenCalled()
  })
})
