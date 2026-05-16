/**
 * assertNoEpisodeConflict — DB-backed guard that refuses a new task
 * when an incompatible active task is already running for the same
 * episode. Locks in the F-QA-2 root-cause behavior at the
 * submit-time layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ConflictTaskRow = {
  id: string
  type: string
  status: string
  createdAt: Date
} | null

const findFirstMock = vi.hoisted(() => vi.fn<(args?: unknown) => Promise<ConflictTaskRow>>(async () => null))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findFirst: findFirstMock,
    },
  },
}))

import { assertNoEpisodeConflict } from '@/lib/task/episode-conflict-guard'
import { TASK_TYPE, TASK_STATUS } from '@/lib/task/types'
import { ApiError } from '@/lib/api-errors'

beforeEach(() => {
  findFirstMock.mockReset()
  findFirstMock.mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('assertNoEpisodeConflict', () => {
  it('passes when no conflicting task exists', async () => {
    findFirstMock.mockResolvedValue(null)
    await expect(
      assertNoEpisodeConflict({ episodeId: 'ep-1', type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN }),
    ).resolves.toBeUndefined()
  })

  it('does not query when the type is not in any conflict group', async () => {
    await assertNoEpisodeConflict({ episodeId: 'ep-1', type: TASK_TYPE.IMAGE_PANEL })
    expect(findFirstMock).not.toHaveBeenCalled()
  })

  it('queries the right where clause for storyboard-graph tasks', async () => {
    findFirstMock.mockResolvedValue(null)
    await assertNoEpisodeConflict({ episodeId: 'ep-1', type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN })
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          episodeId: 'ep-1',
          type: { in: [TASK_TYPE.CLIPS_BUILD] },
          status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
        }),
      }),
    )
  })

  it('throws CONFLICT when an active clips_build blocks script_to_storyboard_run', async () => {
    findFirstMock.mockResolvedValue({
      id: 'task-clips-1',
      type: TASK_TYPE.CLIPS_BUILD,
      status: TASK_STATUS.PROCESSING,
      createdAt: new Date('2026-05-16T05:30:00Z'),
    })

    await expect(
      assertNoEpisodeConflict({ episodeId: 'ep-1', type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: 'CONFLICT',
      details: expect.objectContaining({
        conflictingTaskId: 'task-clips-1',
        conflictingTaskType: TASK_TYPE.CLIPS_BUILD,
        conflictingTaskStatus: TASK_STATUS.PROCESSING,
      }),
    })
  })

  it('throws CONFLICT in the symmetric direction (clips_build blocked by script_to_storyboard_run)', async () => {
    findFirstMock.mockResolvedValue({
      id: 'task-s2s-1',
      type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
      status: TASK_STATUS.QUEUED,
      createdAt: new Date('2026-05-16T05:30:00Z'),
    })

    await expect(
      assertNoEpisodeConflict({ episodeId: 'ep-1', type: TASK_TYPE.CLIPS_BUILD }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: 'CONFLICT',
      details: expect.objectContaining({
        conflictingTaskId: 'task-s2s-1',
        conflictingTaskType: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
        conflictingTaskStatus: TASK_STATUS.QUEUED,
      }),
    })
  })

  it('thrown error has 409 HTTP status', async () => {
    findFirstMock.mockResolvedValue({
      id: 'task-clips-1',
      type: TASK_TYPE.CLIPS_BUILD,
      status: TASK_STATUS.PROCESSING,
      createdAt: new Date(),
    })

    try {
      await assertNoEpisodeConflict({ episodeId: 'ep-1', type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(409)
    }
  })
})
