import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}))

const serviceMock = vi.hoisted(() => ({
  sweepStaleTasks: vi.fn(),
  rollbackTaskBillingForTask: vi.fn(),
}))

const publicationRecoveryMock = vi.hoisted(() => ({
  reconcileNextTerminalVoiceLinePublication: vi.fn(),
}))

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  event: vi.fn(),
  child: vi.fn(),
}))

const queueMock = vi.hoisted(() => ({ getJob: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/service', () => serviceMock)
vi.mock('@/lib/task/voice-line-publication-recovery', () => publicationRecoveryMock)
vi.mock('@/lib/task/publisher', () => ({ publishTaskEvent: vi.fn() }))
vi.mock('@/lib/billing', () => ({ settleTaskBilling: vi.fn() }))
vi.mock('@/lib/task/queues', () => ({
  imageQueue: queueMock,
  videoQueue: queueMock,
  voiceQueue: queueMock,
  textQueue: queueMock,
}))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => loggerMock),
}))

function recoveryResult(nextCursor: string | null) {
  return {
    state: nextCursor ? 'deleted' : 'empty',
    taskId: nextCursor ? 'task-a' : null,
    nextCursor,
  }
}

describe('canonical task watchdog VoiceLine publication recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.resetModules()
    prismaMock.task.findMany.mockReset().mockResolvedValue([])
    serviceMock.sweepStaleTasks.mockReset().mockResolvedValue([])
    publicationRecoveryMock.reconcileNextTerminalVoiceLinePublication
      .mockReset()
      .mockResolvedValueOnce(recoveryResult('task-b'))
      .mockResolvedValueOnce(recoveryResult(null))
      .mockResolvedValueOnce(recoveryResult('task-b'))
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('[watchdog cycles] -> [uses the same scheduler, advances the publication cursor, then wraps to retry]', async () => {
    const { startTaskWatchdog } = await import('@/lib/task/reconcile')
    startTaskWatchdog()
    startTaskWatchdog()

    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(publicationRecoveryMock.reconcileNextTerminalVoiceLinePublication).toHaveBeenCalledTimes(3)
    expect(
      publicationRecoveryMock.reconcileNextTerminalVoiceLinePublication.mock.calls.map(
        ([params]) => params?.afterTaskId,
      ),
    ).toEqual([undefined, 'task-b', undefined])
    expect(vi.getTimerCount()).toBe(1)
  })

  it('[first watchdog recovery is still pending] -> [overlapping tick does not start a second recovery]', async () => {
    let capturedTick: (() => Promise<void>) | null = null
    vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) => {
      capturedTick = callback as unknown as () => Promise<void>
      return 1 as unknown as ReturnType<typeof setInterval>
    })
    let resolveFirst!: (value: ReturnType<typeof recoveryResult>) => void
    const firstRecovery = new Promise<ReturnType<typeof recoveryResult>>((resolve) => {
      resolveFirst = resolve
    })
    publicationRecoveryMock.reconcileNextTerminalVoiceLinePublication
      .mockReset()
      .mockImplementationOnce(async () => await firstRecovery)
      .mockResolvedValue(recoveryResult(null))

    const { startTaskWatchdog } = await import('@/lib/task/reconcile')
    startTaskWatchdog()
    if (!capturedTick) throw new Error('watchdog interval callback was not captured')
    const tick = capturedTick as () => Promise<void>

    const firstTick = tick()
    await vi.waitFor(() => {
      expect(publicationRecoveryMock.reconcileNextTerminalVoiceLinePublication).toHaveBeenCalledTimes(1)
    })

    const overlappingTick = tick()
    await overlappingTick
    expect(publicationRecoveryMock.reconcileNextTerminalVoiceLinePublication).toHaveBeenCalledTimes(1)

    resolveFirst(recoveryResult('task-b'))
    await firstTick

    await tick()
    expect(publicationRecoveryMock.reconcileNextTerminalVoiceLinePublication).toHaveBeenCalledTimes(2)
  })
})
