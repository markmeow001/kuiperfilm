/**
 * Episode-level conflict guard (F-QA-2 root cause).
 *
 * Refuses to admit a new task into the system when an incompatible
 * task is already active for the same episode. See
 * `episode-conflict-matrix.ts` for the rule set.
 */
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { TASK_STATUS, type TaskType } from './types'
import { conflictingTaskTypesForType } from './episode-conflict-matrix'

const ACTIVE_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]

export type EpisodeConflictGuardInput = {
  episodeId: string
  type: TaskType
}

export async function assertNoEpisodeConflict(input: EpisodeConflictGuardInput): Promise<void> {
  const conflictingTypes = conflictingTaskTypesForType(input.type)
  if (conflictingTypes.length === 0) return

  const conflicting = await prisma.task.findFirst({
    where: {
      episodeId: input.episodeId,
      type: { in: conflictingTypes },
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, status: true, createdAt: true },
  })

  if (!conflicting) return

  throw new ApiError('CONFLICT', {
    message: `Cannot start ${input.type}: another task (${conflicting.type}) is still ${conflicting.status} for this episode. Wait for it to finish and try again.`,
    conflictingTaskId: conflicting.id,
    conflictingTaskType: conflicting.type,
    conflictingTaskStatus: conflicting.status,
    conflictingTaskCreatedAt: conflicting.createdAt,
  })
}
