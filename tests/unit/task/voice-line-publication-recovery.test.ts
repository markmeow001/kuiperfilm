import { createHash } from 'node:crypto'
import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
  },
}))

const publicationMock = vi.hoisted(() => ({
  reconcileVoiceLineTerminalState: vi.fn(),
}))

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  event: vi.fn(),
  child: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/voice/voice-line-publication', () => publicationMock)
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => loggerMock),
}))
vi.mock('server-only', () => ({}))

import { reconcileNextTerminalVoiceLinePublication } from '@/lib/task/voice-line-publication-recovery'

const SOURCE_FINGERPRINT = 'f'.repeat(64)

function terminalTask(
  id: string,
  status: typeof TASK_STATUS.FAILED | typeof TASK_STATUS.DISMISSED = TASK_STATUS.FAILED,
) {
  const suffix = id.replace('task-', '')
  const audioSha256 = suffix.repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, 'a')
  const taskHash = createHash('sha256').update(id).digest('hex').slice(0, 32)
  const outputUrl = `voice/project-${suffix}/episode-${suffix}/line-${suffix}/${taskHash}-${audioSha256}.wav`
  const payload = {
    episodeId: `episode-${suffix}`,
    lineId: `line-${suffix}`,
    sourceFingerprint: SOURCE_FINGERPRINT,
    meta: { locale: suffix === 'b' ? 'en' : 'zh' },
    voiceLinePublication: {
      kind: 'voice_line_publication_v1',
      state: 'cleanup_failed',
      taskId: id,
      projectId: `project-${suffix}`,
      episodeId: `episode-${suffix}`,
      lineId: `line-${suffix}`,
      sourceFingerprint: SOURCE_FINGERPRINT,
      outputUrl,
      audioSha256,
      audioBytes: 321,
      audioDuration: 1_250,
      input: {
        speaker: `speaker-${suffix}`,
        content: `content-${suffix}`,
        voicePresetId: null,
        emotionPrompt: null,
        emotionStrength: null,
        speakerVoices: null,
        audioUrl: null,
        audioMediaId: null,
        audioDuration: null,
      },
      result: {
        lineId: `line-${suffix}`,
        audioUrl: outputUrl,
        storageKey: outputUrl,
        audioDuration: 1_250,
      },
    },
  }
  return {
    id,
    userId: `user-${suffix}`,
    projectId: `project-${suffix}`,
    episodeId: `episode-${suffix}`,
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'NovelPromotionVoiceLine',
    targetId: `line-${suffix}`,
    status,
    payload,
    billingInfo: { billable: false as const },
  }
}

function expectedCleanupJob(task: ReturnType<typeof terminalTask>): Job<TaskJobData> {
  return {
    id: task.id,
    data: {
      taskId: task.id,
      type: TASK_TYPE.VOICE_LINE,
      locale: task.payload.meta.locale,
      projectId: task.projectId,
      episodeId: task.episodeId,
      targetType: task.targetType,
      targetId: task.targetId,
      payload: task.payload,
      billingInfo: task.billingInfo,
      userId: task.userId,
      trace: null,
    },
  } as unknown as Job<TaskJobData>
}

describe('single terminal VoiceLine publication recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockReset().mockResolvedValue([])
    publicationMock.reconcileVoiceLineTerminalState.mockReset()
  })

  it('[terminal VoiceLine exists] -> [reconciles only the next exact persisted tuple]', async () => {
    const task = terminalTask('task-a')
    prismaMock.task.findMany.mockResolvedValueOnce([task])
    publicationMock.reconcileVoiceLineTerminalState.mockResolvedValueOnce('deleted')

    await expect(reconcileNextTerminalVoiceLinePublication({
      afterTaskId: 'task-000',
    })).resolves.toEqual({
      state: 'deleted',
      taskId: 'task-a',
      nextCursor: 'task-a',
    })

    expect(prismaMock.task.findMany).toHaveBeenCalledWith({
      where: {
        type: TASK_TYPE.VOICE_LINE,
        status: { in: [TASK_STATUS.FAILED, TASK_STATUS.DISMISSED] },
        id: { gt: 'task-000' },
      },
      select: {
        id: true,
        userId: true,
        projectId: true,
        episodeId: true,
        type: true,
        targetType: true,
        targetId: true,
        payload: true,
        billingInfo: true,
      },
      orderBy: { id: 'asc' },
      take: 1,
    })
    expect(publicationMock.reconcileVoiceLineTerminalState).toHaveBeenCalledWith(
      expectedCleanupJob(task),
      { verifyDeletedObject: true },
    )
  })

  it('[next exact terminal cleanup fails] -> [logs that task and advances one cursor]', async () => {
    const task = terminalTask('task-a')
    prismaMock.task.findMany.mockResolvedValueOnce([task])
    publicationMock.reconcileVoiceLineTerminalState.mockRejectedValueOnce(
      new Error('storage unavailable'),
    )

    await expect(reconcileNextTerminalVoiceLinePublication()).resolves.toEqual({
      state: 'failed',
      taskId: 'task-a',
      nextCursor: 'task-a',
    })
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'voice_line.publication_recovery.failed',
      message: 'VoiceLine terminal publication recovery failed',
      taskId: 'task-a',
      projectId: 'project-a',
      userId: 'user-a',
      retryable: true,
      error: expect.objectContaining({
        name: 'Error',
        message: 'storage unavailable',
      }),
    }))
  })

  it('[cursor reaches the end] -> [null cursor lets a later cycle revisit one failed task]', async () => {
    const first = terminalTask('task-a')
    const second = terminalTask('task-b')
    prismaMock.task.findMany
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([first])
    publicationMock.reconcileVoiceLineTerminalState
      .mockRejectedValueOnce(new Error('temporary COS outage'))
      .mockResolvedValueOnce('deleted')
      .mockResolvedValueOnce('deleted')

    const cycle1 = await reconcileNextTerminalVoiceLinePublication()
    const cycle2 = await reconcileNextTerminalVoiceLinePublication({ afterTaskId: cycle1.nextCursor || undefined })
    const cycle3 = await reconcileNextTerminalVoiceLinePublication({ afterTaskId: cycle2.nextCursor || undefined })
    const cycle4 = await reconcileNextTerminalVoiceLinePublication({ afterTaskId: cycle3.nextCursor || undefined })

    expect(cycle1).toEqual({ state: 'failed', taskId: 'task-a', nextCursor: 'task-a' })
    expect(cycle2).toEqual({ state: 'deleted', taskId: 'task-b', nextCursor: 'task-b' })
    expect(cycle3).toEqual({ state: 'empty', taskId: null, nextCursor: null })
    expect(cycle4).toEqual({ state: 'deleted', taskId: 'task-a', nextCursor: 'task-a' })
    expect(prismaMock.task.findMany.mock.calls.map(([query]) => query.where)).toEqual([
      {
        type: TASK_TYPE.VOICE_LINE,
        status: { in: [TASK_STATUS.FAILED, TASK_STATUS.DISMISSED] },
      },
      {
        type: TASK_TYPE.VOICE_LINE,
        status: { in: [TASK_STATUS.FAILED, TASK_STATUS.DISMISSED] },
        id: { gt: 'task-a' },
      },
      {
        type: TASK_TYPE.VOICE_LINE,
        status: { in: [TASK_STATUS.FAILED, TASK_STATUS.DISMISSED] },
        id: { gt: 'task-b' },
      },
      {
        type: TASK_TYPE.VOICE_LINE,
        status: { in: [TASK_STATUS.FAILED, TASK_STATUS.DISMISSED] },
      },
    ])
    expect(publicationMock.reconcileVoiceLineTerminalState.mock.calls[2]?.[0]).toEqual(
      expectedCleanupJob(first),
    )
  })
})
