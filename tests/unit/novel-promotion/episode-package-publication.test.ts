import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const cosMock = vi.hoisted(() => ({
  deleteCOSObject: vi.fn(async () => undefined),
}))

const prismaMock = vi.hoisted(() => {
  const tx = {
    task: {
      updateMany: vi.fn(),
    },
    novelPromotionEpisode: {
      updateMany: vi.fn(),
    },
  }
  return {
    task: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    novelPromotionEpisode: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    tx,
  }
})

vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('server-only', () => ({}))

import {
  claimEpisodePackageCompletion,
  type EpisodePackageTaskResult,
} from '@/lib/novel-promotion/episode-package-publication'

const result: EpisodePackageTaskResult = {
  episodeId: 'episode-a',
  outputUrl: 'images/episode-pack-episode-a-task-a.zip',
  panelCount: 1,
  sourceFingerprint: 'f'.repeat(64),
  manifest: {
    version: 1,
    fileCount: 3,
    selectedVideoCount: 1,
    multiShotVideoCount: 0,
    imageCount: 0,
    voiceAudioCount: 0,
    excludedVoiceLineCount: 0,
    scriptIncluded: true,
    checksumAlgorithm: 'sha256',
  },
}

const preparedMarker = {
  kind: 'episode_package_publication_v1' as const,
  state: 'prepared' as const,
  taskId: 'task-a',
  projectId: 'project-a',
  episodeId: 'episode-a',
  outputUrl: result.outputUrl,
  sourceFingerprint: result.sourceFingerprint,
  archiveSha256: 'a'.repeat(64),
  archiveBytes: 123,
  result,
}

function makeJob(): Job<TaskJobData> {
  return {
    id: 'task-a',
    data: {
      taskId: 'task-a',
      type: 'episode_stitch_mp4',
      userId: 'user-a',
      projectId: 'project-a',
      episodeId: 'episode-a',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-a',
      payload: { episodeId: 'episode-a', sourceFingerprint: 'f'.repeat(64) },
    },
  } as unknown as Job<TaskJobData>
}

describe('episode package publication lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.tx.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.tx.novelPromotionEpisode.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    cosMock.deleteCOSObject.mockResolvedValue(undefined)
  })

  it('[completion winner] -> [claims exact active task and episode pointer in one transaction]', async () => {
    await expect(claimEpisodePackageCompletion(makeJob(), result)).resolves.toBe(true)

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.tx.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'task-a',
        userId: 'user-a',
        projectId: 'project-a',
        episodeId: 'episode-a',
        type: 'episode_stitch_mp4',
        targetType: 'NovelPromotionEpisode',
        targetId: 'episode-a',
        status: { in: ['queued', 'processing'] },
      },
      data: expect.objectContaining({
        status: 'completed',
        progress: 100,
        result,
        finishedAt: expect.any(Date),
      }),
    }))
    expect(prismaMock.tx.novelPromotionEpisode.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'episode-a',
        novelPromotionProject: { projectId: 'project-a' },
      },
      data: {
        stitchedVideoUrl: result.outputUrl,
        stitchStatus: 'completed',
        stitchedAt: expect.any(Date),
      },
    })
  })

  it('[episode scoped write misses] -> [transaction rejects instead of committing Task alone]', async () => {
    prismaMock.tx.novelPromotionEpisode.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(claimEpisodePackageCompletion(makeJob(), result)).rejects.toThrow(
      'EPISODE_PACKAGE_COMPLETION_RECONCILIATION_REQUIRED',
    )
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[cancel wins after upload] -> [scoped reread proves unreferenced key then strict delete]', async () => {
    prismaMock.tx.task.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'failed',
      errorCode: 'TASK_CANCELLED',
      payload: { episodePackagePublication: preparedMarker },
      result: null,
      finishedAt: new Date(),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      stitchedVideoUrl: 'images/previous-package.zip',
      stitchStatus: 'completed',
      stitchedAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    await expect(claimEpisodePackageCompletion(makeJob(), result)).resolves.toBe(false)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(result.outputUrl, { throwOnError: true })
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'task-a',
        projectId: 'project-a',
        episodeId: 'episode-a',
      }),
      data: expect.objectContaining({ payload: expect.anything() }),
    }))
  })

  it('[completion transaction response is lost] -> [scoped reread of both durable truths reconciles success without delete]', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error('database response lost'))
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'completed',
      errorCode: null,
      payload: {},
      result,
      finishedAt: new Date('2026-08-10T00:00:00.000Z'),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      stitchedVideoUrl: result.outputUrl,
      stitchStatus: 'completed',
      stitchedAt: new Date('2026-08-10T00:00:00.000Z'),
    })

    await expect(claimEpisodePackageCompletion(makeJob(), result)).resolves.toBe(true)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[completion outcome reread is unknown] -> [retains exact key and marker, never deletes]', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error('database response lost'))
    prismaMock.task.findFirst.mockRejectedValueOnce(new Error('database still unavailable'))

    await expect(claimEpisodePackageCompletion(makeJob(), result)).rejects.toThrow(
      'EPISODE_PACKAGE_COMPLETION_RECONCILIATION_REQUIRED',
    )
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[cancel cleanup fails] -> [persists observable cleanup_failed marker and throws explicit error]', async () => {
    prismaMock.tx.task.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'failed',
      errorCode: 'TASK_CANCELLED',
      payload: { episodePackagePublication: preparedMarker },
      result: null,
      finishedAt: new Date(),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      stitchedVideoUrl: 'images/previous-package.zip',
      stitchStatus: 'completed',
      stitchedAt: new Date('2026-08-01T00:00:00.000Z'),
    })
    cosMock.deleteCOSObject.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(claimEpisodePackageCompletion(makeJob(), result)).rejects.toThrow(
      'EPISODE_PACKAGE_OUTPUT_CLEANUP_FAILED',
    )
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          episodePackagePublication: expect.objectContaining({
            state: 'cleanup_failed',
            cleanupError: 'storage unavailable',
          }),
        }),
      }),
    }))
  })

  it('[cancelled task has no exact durable marker] -> [retains object and fails reconciliation]', async () => {
    prismaMock.tx.task.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'failed', errorCode: 'TASK_CANCELLED', payload: {}, result: null, finishedAt: new Date(),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      stitchedVideoUrl: 'images/previous-package.zip',
      stitchStatus: 'completed',
      stitchedAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    await expect(claimEpisodePackageCompletion(makeJob(), result)).rejects.toThrow(
      'EPISODE_PACKAGE_COMPLETION_RECONCILIATION_REQUIRED',
    )
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[cleanup success response is retried with deleted marker] -> [idempotently skips a second delete]', async () => {
    prismaMock.tx.task.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'failed',
      errorCode: 'TASK_CANCELLED',
      payload: { episodePackagePublication: { ...preparedMarker, state: 'deleted' } },
      result: null,
      finishedAt: new Date(),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      stitchedVideoUrl: 'images/previous-package.zip',
      stitchStatus: 'completed',
      stitchedAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    await expect(claimEpisodePackageCompletion(makeJob(), result)).resolves.toBe(false)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[cleanup_failed marker is retried] -> [strict delete succeeds and marker advances to deleted]', async () => {
    prismaMock.tx.task.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'failed',
      errorCode: 'TASK_CANCELLED',
      payload: {
        episodePackagePublication: {
          ...preparedMarker,
          state: 'cleanup_failed',
          cleanupError: 'previous storage outage',
        },
      },
      result: null,
      finishedAt: new Date(),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      stitchedVideoUrl: 'images/previous-package.zip',
      stitchStatus: 'completed',
      stitchedAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    await expect(claimEpisodePackageCompletion(makeJob(), result)).resolves.toBe(false)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledTimes(1)
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          episodePackagePublication: expect.objectContaining({ state: 'deleted' }),
        }),
      }),
    }))
  })
})
