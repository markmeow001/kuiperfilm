import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const taskServiceMock = vi.hoisted(() => ({
  rollbackTaskBillingForTask: vi.fn(),
  touchTaskHeartbeat: vi.fn(async () => true),
  tryMarkTaskCompleted: vi.fn(),
  tryMarkTaskFailed: vi.fn(async () => false),
  tryMarkTaskProcessing: vi.fn(async () => false),
  tryUpdateTaskProgress: vi.fn(),
  updateTaskBillingInfo: vi.fn(),
}))

const publisherMock = vi.hoisted(() => ({
  publishTaskEvent: vi.fn(async () => ({})),
  publishTaskStreamEvent: vi.fn(async () => ({})),
}))

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const cosMock = vi.hoisted(() => ({
  deleteCOSObject: vi.fn(async () => undefined),
}))

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn(async () => null) },
  task: {
    findFirst: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  novelPromotionEpisode: { findFirst: vi.fn() },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/task/publisher', () => publisherMock)
vi.mock('@/lib/task/queues', () => ({ rateLimitAwareBackoff: vi.fn(() => 1_000) }))
vi.mock('@/lib/billing', () => ({ settleTaskBilling: vi.fn() }))
vi.mock('@/lib/billing/runtime-usage', () => ({
  withTextUsageCollection: vi.fn(async <T>(operation: () => Promise<T>) => ({
    result: await operation(),
    textUsage: [],
  })),
}))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => loggerMock),
  logError: vi.fn(),
}))
vi.mock('@/lib/logging/file-writer', () => ({ onProjectNameAvailable: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
}))
vi.mock('@/lib/cos', () => cosMock)

import { reconcileEpisodePackageTerminalState } from '@/lib/novel-promotion/episode-package-publication'
import { withTaskLifecycle } from '@/lib/workers/shared'

const result = {
  episodeId: 'episode-a',
  outputUrl: 'images/episode-pack-episode-a-task-a.zip',
  panelCount: 1,
  sourceFingerprint: 'f'.repeat(64),
  manifest: {
    version: 1 as const,
    fileCount: 3,
    selectedVideoCount: 1,
    multiShotVideoCount: 0,
    imageCount: 0,
    voiceAudioCount: 0,
    excludedVoiceLineCount: 0,
    scriptIncluded: true as const,
    checksumAlgorithm: 'sha256' as const,
  },
}

function marker(state: 'prepared' | 'deleted' | 'cleanup_failed') {
  return {
    kind: 'episode_package_publication_v1',
    state,
    taskId: 'task-a',
    projectId: 'project-a',
    episodeId: 'episode-a',
    outputUrl: result.outputUrl,
    sourceFingerprint: result.sourceFingerprint,
    archiveSha256: 'a'.repeat(64),
    archiveBytes: 123,
    result,
    ...(state === 'cleanup_failed' ? { cleanupError: 'storage unavailable' } : {}),
  }
}

function makeJob(): Job<TaskJobData> {
  return {
    id: 'task-a',
    queueName: 'video',
    opts: { attempts: 2 },
    attemptsMade: 0,
    data: {
      taskId: 'task-a',
      type: TASK_TYPE.EPISODE_STITCH_MP4,
      locale: 'en',
      userId: 'user-a',
      projectId: 'project-a',
      episodeId: 'episode-a',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-a',
      payload: { episodeId: 'episode-a', sourceFingerprint: result.sourceFingerprint },
    },
  } as unknown as Job<TaskJobData>
}

function setTerminalRows(params: {
  status: 'completed' | 'failed' | 'dismissed'
  markerState: 'prepared' | 'deleted' | 'cleanup_failed'
  episodePointer?: string | null
}) {
  prismaMock.task.findFirst.mockResolvedValue({
    status: params.status,
    errorCode: params.status === 'completed' ? null : 'TASK_CANCELLED',
    payload: { episodePackagePublication: marker(params.markerState) },
    result: params.status === 'completed' ? result : null,
    finishedAt: new Date('2026-08-10T00:00:00.000Z'),
  })
  prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
    stitchedVideoUrl: params.episodePointer === undefined
      ? 'images/previous-package.zip'
      : params.episodePointer,
    stitchStatus: 'completed',
    stitchedAt: new Date('2026-08-01T00:00:00.000Z'),
  })
}

async function runTerminalLifecycle(handler: ReturnType<typeof vi.fn>) {
  const job = makeJob()
  return await withTaskLifecycle(job, handler, {
    terminalReconcile: async () => await reconcileEpisodePackageTerminalState(job),
  })
}

describe('episode package terminal lifecycle reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskServiceMock.tryMarkTaskProcessing.mockResolvedValue(false)
    taskServiceMock.tryMarkTaskFailed.mockResolvedValue(false)
    taskServiceMock.touchTaskHeartbeat.mockResolvedValue(true)
    cosMock.deleteCOSObject.mockResolvedValue(undefined)
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
  })

  it.each([
    { status: 'dismissed' as const, markerState: 'cleanup_failed' as const },
    { status: 'failed' as const, markerState: 'prepared' as const },
  ])(
    '[$status task with $markerState marker] -> [terminal lifecycle deletes exact marker key, marks deleted, and runs zero handler work]',
    async ({ status, markerState }) => {
      setTerminalRows({ status, markerState })
      const handler = vi.fn(async () => result)

      await expect(runTerminalLifecycle(handler)).resolves.toBeUndefined()

      expect(handler).not.toHaveBeenCalled()
      expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(result.outputUrl, { throwOnError: true })
      expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: 'task-a', projectId: 'project-a', episodeId: 'episode-a',
        }),
        data: expect.objectContaining({
          payload: expect.objectContaining({
            episodePackagePublication: expect.objectContaining({ state: 'deleted' }),
          }),
        }),
      }))
      expect(publisherMock.publishTaskEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'task.processing' }),
      )
    },
  )

  it.each(['prepared', 'deleted'] as const)(
    '[completed task with %s marker] -> [zero handler work and never deletes the published key]',
    async (markerState) => {
      setTerminalRows({
        status: 'completed',
        markerState,
        episodePointer: result.outputUrl,
      })
      const handler = vi.fn(async () => result)

      await expect(runTerminalLifecycle(handler)).resolves.toBeUndefined()

      expect(handler).not.toHaveBeenCalled()
      expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
      expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
    },
  )

  it('[failed task marker is still referenced by episode] -> [fails closed without deleting]', async () => {
    setTerminalRows({ status: 'failed', markerState: 'prepared', episodePointer: result.outputUrl })
    const handler = vi.fn(async () => result)

    await expect(runTerminalLifecycle(handler)).rejects.toThrow()

    expect(handler).not.toHaveBeenCalled()
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })

  it('[terminal scoped reread is unknown] -> [retains marker/object and runs zero handler work]', async () => {
    prismaMock.task.findFirst.mockRejectedValue(new Error('database unavailable'))
    const handler = vi.fn(async () => result)

    await expect(runTerminalLifecycle(handler)).rejects.toThrow()

    expect(handler).not.toHaveBeenCalled()
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })
})
