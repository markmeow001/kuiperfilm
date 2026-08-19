import 'server-only'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { deleteCOSObject } from '@/lib/cos'
import { logError } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { TaskTerminatedError } from '@/lib/task/errors'
import { TASK_STATUS, TASK_TYPE, type TaskBillingInfo, type TaskJobData } from '@/lib/task/types'
import {
  episodePackageStorageKey,
  parseEpisodeDeliveryManifestSummary,
  type EpisodeDeliveryManifestSummary,
} from '@/lib/novel-promotion/episode-delivery-manifest'

const PUBLICATION_MARKER_KEY = 'episodePackagePublication'
const ACTIVE_TASK_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] as const

export type EpisodePackageTaskResult = {
  episodeId: string
  outputUrl: string
  panelCount: number
  sourceFingerprint: string
  manifest: EpisodeDeliveryManifestSummary
}

export type EpisodePackagePreparedOutput = {
  kind: 'episode_package_publication_v1'
  state: 'prepared' | 'deleted' | 'cleanup_failed'
  taskId: string
  projectId: string
  episodeId: string
  outputUrl: string
  sourceFingerprint: string
  archiveSha256: string
  archiveBytes: number
  result: EpisodePackageTaskResult
  cleanupError?: string
}

type CompletionBilling = {
  billingInfo?: TaskBillingInfo | null
  billedAt?: Date | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function exactTaskWhere(job: Job<TaskJobData>) {
  return {
    id: job.data.taskId,
    userId: job.data.userId,
    projectId: job.data.projectId,
    episodeId: job.data.episodeId || null,
    type: TASK_TYPE.EPISODE_STITCH_MP4,
    targetType: 'NovelPromotionEpisode',
    targetId: job.data.targetId,
  }
}

function validateJobTuple(job: Job<TaskJobData>): void {
  const taskId = typeof job.data.taskId === 'string' ? job.data.taskId.trim() : ''
  const episodeId = typeof job.data.episodeId === 'string' ? job.data.episodeId.trim() : ''
  const jobId = typeof job.id === 'string' || typeof job.id === 'number' ? String(job.id) : ''
  if (
    !taskId
    || jobId !== taskId
    || !job.data.projectId
    || !job.data.userId
    || !episodeId
    || job.data.type !== TASK_TYPE.EPISODE_STITCH_MP4
    || job.data.targetType !== 'NovelPromotionEpisode'
    || job.data.targetId !== episodeId
  ) {
    throw new Error('EPISODE_PACKAGE_TASK_TARGET_INVALID')
  }
}

function parseTaskResult(value: unknown): EpisodePackageTaskResult | null {
  if (!isRecord(value)) return null
  const manifest = parseEpisodeDeliveryManifestSummary(value.manifest)
  if (
    typeof value.episodeId !== 'string'
    || typeof value.outputUrl !== 'string'
    || !nonNegativeInteger(value.panelCount)
    || !isFingerprint(value.sourceFingerprint)
    || !manifest
  ) return null
  return {
    episodeId: value.episodeId,
    outputUrl: value.outputUrl,
    panelCount: value.panelCount,
    sourceFingerprint: value.sourceFingerprint,
    manifest,
  }
}

function assertResultContext(job: Job<TaskJobData>, value: unknown): EpisodePackageTaskResult {
  validateJobTuple(job)
  const result = parseTaskResult(value)
  const episodeId = job.data.episodeId!
  const expectedKey = episodePackageStorageKey(episodeId, job.data.taskId)
  const submittedFingerprint = isRecord(job.data.payload)
    ? job.data.payload.sourceFingerprint
    : null
  if (
    !result
    || result.episodeId !== episodeId
    || result.outputUrl !== expectedKey
    || !isFingerprint(submittedFingerprint)
    || result.sourceFingerprint !== submittedFingerprint
  ) {
    throw new Error('EPISODE_PACKAGE_RESULT_CONTEXT_INVALID')
  }
  return result
}

function sameTaskResult(left: unknown, right: EpisodePackageTaskResult): boolean {
  const parsed = parseTaskResult(left)
  return !!parsed
    && parsed.episodeId === right.episodeId
    && parsed.outputUrl === right.outputUrl
    && parsed.panelCount === right.panelCount
    && parsed.sourceFingerprint === right.sourceFingerprint
    && JSON.stringify(parsed.manifest) === JSON.stringify(right.manifest)
}

function parsePreparedOutput(value: unknown): EpisodePackagePreparedOutput | null {
  if (!isRecord(value) || value.kind !== 'episode_package_publication_v1') return null
  const result = parseTaskResult(value.result)
  if (
    (value.state !== 'prepared' && value.state !== 'deleted' && value.state !== 'cleanup_failed')
    || typeof value.taskId !== 'string'
    || typeof value.projectId !== 'string'
    || typeof value.episodeId !== 'string'
    || typeof value.outputUrl !== 'string'
    || !isFingerprint(value.sourceFingerprint)
    || !isFingerprint(value.archiveSha256)
    || !nonNegativeInteger(value.archiveBytes)
    || !result
    || result.episodeId !== value.episodeId
    || result.outputUrl !== value.outputUrl
    || result.sourceFingerprint !== value.sourceFingerprint
  ) return null
  return {
    kind: 'episode_package_publication_v1',
    state: value.state,
    taskId: value.taskId,
    projectId: value.projectId,
    episodeId: value.episodeId,
    outputUrl: value.outputUrl,
    sourceFingerprint: value.sourceFingerprint,
    archiveSha256: value.archiveSha256,
    archiveBytes: value.archiveBytes,
    result,
    ...(typeof value.cleanupError === 'string' ? { cleanupError: value.cleanupError } : {}),
  }
}

function assertMarkerContext(
  job: Job<TaskJobData>,
  marker: EpisodePackagePreparedOutput,
): EpisodePackagePreparedOutput {
  const result = assertResultContext(job, marker.result)
  if (
    marker.taskId !== job.data.taskId
    || marker.projectId !== job.data.projectId
    || marker.episodeId !== job.data.episodeId
    || marker.outputUrl !== result.outputUrl
    || marker.sourceFingerprint !== result.sourceFingerprint
  ) {
    throw new Error('EPISODE_PACKAGE_PUBLICATION_MARKER_CONTEXT_INVALID')
  }
  return marker
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function reconciliationRequired(cause: unknown): Error {
  return Object.assign(
    new Error('EPISODE_PACKAGE_COMPLETION_RECONCILIATION_REQUIRED'),
    { code: 'EXTERNAL_ERROR', cause },
  )
}

function cleanupFailed(cause: unknown): Error {
  return Object.assign(
    new Error('EPISODE_PACKAGE_OUTPUT_CLEANUP_FAILED'),
    { code: 'EXTERNAL_ERROR', cause },
  )
}

export async function readEpisodePackagePreparedOutput(
  job: Job<TaskJobData>,
): Promise<EpisodePackagePreparedOutput | null> {
  validateJobTuple(job)
  const task = await prisma.task.findFirst({
    where: exactTaskWhere(job),
    select: { status: true, payload: true, result: true, finishedAt: true, errorCode: true },
  })
  if (!task) throw new Error('EPISODE_PACKAGE_TASK_SCOPE_MISMATCH')
  const payload = isRecord(task.payload) ? task.payload : {}
  const rawMarker = payload[PUBLICATION_MARKER_KEY]
  if (rawMarker === undefined || rawMarker === null) return null
  const marker = parsePreparedOutput(rawMarker)
  if (!marker) throw new Error('EPISODE_PACKAGE_PUBLICATION_MARKER_INVALID')
  return assertMarkerContext(job, marker)
}

export async function persistEpisodePackagePreparedOutput(
  job: Job<TaskJobData>,
  marker: EpisodePackagePreparedOutput,
): Promise<void> {
  validateJobTuple(job)
  assertMarkerContext(job, marker)
  if (marker.state !== 'prepared') {
    throw new Error('EPISODE_PACKAGE_PUBLICATION_MARKER_INVALID')
  }
  const task = await prisma.task.findFirst({
    where: exactTaskWhere(job),
    select: { status: true, payload: true },
  })
  if (!task || (task.status !== TASK_STATUS.QUEUED && task.status !== TASK_STATUS.PROCESSING)) {
    throw new TaskTerminatedError(job.data.taskId, 'Task terminated before package upload marker was stored')
  }
  const payload = isRecord(task.payload) ? task.payload : {}
  const stored = await prisma.task.updateMany({
    where: {
      ...exactTaskWhere(job),
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
    data: {
      payload: toJson({ ...payload, [PUBLICATION_MARKER_KEY]: marker }),
    },
  })
  if (stored.count !== 1) {
    throw new TaskTerminatedError(job.data.taskId, 'Task terminated before package upload marker was stored')
  }
}

async function persistCleanupState(
  job: Job<TaskJobData>,
  taskPayload: unknown,
  marker: EpisodePackagePreparedOutput,
  state: 'deleted' | 'cleanup_failed',
  error?: unknown,
): Promise<void> {
  const payload = isRecord(taskPayload) ? taskPayload : {}
  const cleanupError = error instanceof Error ? error.message : error === undefined ? undefined : String(error)
  const { cleanupError: _previousCleanupError, ...markerWithoutCleanupError } = marker
  const nextMarker: EpisodePackagePreparedOutput = {
    ...markerWithoutCleanupError,
    state,
    ...(cleanupError ? { cleanupError: cleanupError.slice(0, 1000) } : {}),
  }
  const updated = await withPrismaRetry(() => prisma.task.updateMany({
    where: exactTaskWhere(job),
    data: {
      payload: toJson({ ...payload, [PUBLICATION_MARKER_KEY]: nextMarker }),
    },
  }), { maxRetries: 4, initialDelayMs: 50 })
  if (updated.count !== 1) {
    throw new Error('EPISODE_PACKAGE_CLEANUP_STATE_PERSIST_FAILED')
  }
}

async function readScopedPublicationState(job: Job<TaskJobData>) {
  return await Promise.all([
    prisma.task.findFirst({
      where: exactTaskWhere(job),
      select: {
        status: true,
        errorCode: true,
        payload: true,
        result: true,
        finishedAt: true,
      },
    }),
    prisma.novelPromotionEpisode.findFirst({
      where: {
        id: job.data.episodeId!,
        novelPromotionProject: { projectId: job.data.projectId },
      },
      select: {
        stitchedVideoUrl: true,
        stitchStatus: true,
        stitchedAt: true,
      },
    }),
  ])
}

async function reconcileOrCleanup(
  job: Job<TaskJobData>,
  result: EpisodePackageTaskResult,
  cause?: unknown,
): Promise<boolean> {
  let task: Awaited<ReturnType<typeof readScopedPublicationState>>[0]
  let episode: Awaited<ReturnType<typeof readScopedPublicationState>>[1]
  try {
    ;[task, episode] = await readScopedPublicationState(job)
  } catch (readError) {
    throw reconciliationRequired({ cause, readError })
  }
  if (!task || !episode) {
    throw reconciliationRequired({ cause, reason: 'scoped row missing' })
  }
  if (
    task.status === TASK_STATUS.COMPLETED
    && !!task.finishedAt
    && sameTaskResult(task.result, result)
    && episode.stitchedVideoUrl === result.outputUrl
    && episode.stitchStatus === 'completed'
    && !!episode.stitchedAt
  ) {
    return true
  }

  const terminalWithoutReceipt = task.status === TASK_STATUS.FAILED || task.status === TASK_STATUS.DISMISSED
  if (!terminalWithoutReceipt || episode.stitchedVideoUrl === result.outputUrl) {
    throw reconciliationRequired({ cause, taskStatus: task.status, episodePointer: episode.stitchedVideoUrl })
  }

  const rawMarker = isRecord(task.payload) ? task.payload[PUBLICATION_MARKER_KEY] : null
  const parsedMarker = parsePreparedOutput(rawMarker)
  if (!parsedMarker || parsedMarker.outputUrl !== result.outputUrl) {
    throw reconciliationRequired({ cause, reason: 'durable publication marker missing or invalid' })
  }
  const marker = assertMarkerContext(job, parsedMarker)
  if (marker.state === 'deleted') return false
  try {
    // The durable marker is the deletion authority. The handler/result tuple
    // is validated above, but must never be used to synthesize a cleanup key.
    await deleteCOSObject(marker.outputUrl, { throwOnError: true })
  } catch (deleteError) {
    try {
      await persistCleanupState(job, task.payload, marker, 'cleanup_failed', deleteError)
    } catch (persistError) {
      logError('episode package cleanup failure could not be persisted', {
        taskId: job.data.taskId,
        projectId: job.data.projectId,
        episodeId: job.data.episodeId,
        outputUrl: result.outputUrl,
        deleteError: deleteError instanceof Error ? deleteError.message : String(deleteError),
        persistError: persistError instanceof Error ? persistError.message : String(persistError),
      })
      throw cleanupFailed({ deleteError, persistError })
    }
    throw cleanupFailed(deleteError)
  }
  try {
    await persistCleanupState(job, task.payload, marker, 'deleted')
  } catch (persistError) {
    throw cleanupFailed({ reason: 'deleted marker persist failed', persistError })
  }
  return false
}

export async function cleanupEpisodePackageOutputAfterTermination(
  job: Job<TaskJobData>,
  value: unknown,
): Promise<'published' | 'deleted'> {
  const result = assertResultContext(job, value)
  return await reconcileOrCleanup(job, result) ? 'published' : 'deleted'
}

/**
 * Reconciles only the task state that blocked the generic active->processing
 * claim. Completed tasks remain untouched; active duplicate workers remain a
 * no-op. Failed/dismissed tasks may delete only the exact key authorized by a
 * durable publication marker and only after a scoped episode reread proves the
 * key is no longer referenced.
 */
export async function reconcileEpisodePackageTerminalState(
  job: Job<TaskJobData>,
): Promise<'active' | 'published' | 'no_output' | 'deleted'> {
  validateJobTuple(job)
  let task: Awaited<ReturnType<typeof readScopedPublicationState>>[0]
  let episode: Awaited<ReturnType<typeof readScopedPublicationState>>[1]
  try {
    ;[task, episode] = await readScopedPublicationState(job)
  } catch (readError) {
    throw reconciliationRequired({ reason: 'terminal scoped reread failed', readError })
  }
  if (!task || !episode) {
    throw reconciliationRequired({ reason: 'terminal scoped row missing' })
  }
  if (task.status === TASK_STATUS.COMPLETED) return 'published'
  if (task.status === TASK_STATUS.QUEUED || task.status === TASK_STATUS.PROCESSING) return 'active'

  const rawMarker = isRecord(task.payload) ? task.payload[PUBLICATION_MARKER_KEY] : null
  if (rawMarker === undefined || rawMarker === null) return 'no_output'
  const marker = parsePreparedOutput(rawMarker)
  if (!marker) {
    throw reconciliationRequired({ reason: 'terminal durable publication marker invalid' })
  }
  assertMarkerContext(job, marker)
  return await reconcileOrCleanup(job, marker.result) ? 'published' : 'deleted'
}

export async function claimEpisodePackageCompletion(
  job: Job<TaskJobData>,
  value: unknown,
  billing?: CompletionBilling,
): Promise<boolean> {
  const result = assertResultContext(job, value)
  const finishedAt = new Date()
  let claimed: boolean
  try {
    claimed = await prisma.$transaction(async (tx) => {
      const task = await tx.task.updateMany({
        where: {
          ...exactTaskWhere(job),
          status: { in: [...ACTIVE_TASK_STATUSES] },
        },
        data: {
          status: TASK_STATUS.COMPLETED,
          progress: 100,
          result: toJson(result),
          finishedAt,
          heartbeatAt: null,
          ...(billing?.billingInfo !== undefined
            ? { billingInfo: billing.billingInfo === null ? Prisma.JsonNull : toJson(billing.billingInfo) }
            : {}),
          ...(billing?.billedAt !== undefined ? { billedAt: billing.billedAt } : {}),
        },
      })
      if (task.count !== 1) return false
      const episode = await tx.novelPromotionEpisode.updateMany({
        where: {
          id: result.episodeId,
          novelPromotionProject: { projectId: job.data.projectId },
        },
        data: {
          stitchedVideoUrl: result.outputUrl,
          stitchStatus: 'completed',
          stitchedAt: finishedAt,
        },
      })
      if (episode.count !== 1) {
        throw new Error('EPISODE_PACKAGE_PROJECT_SCOPE_MISMATCH')
      }
      return true
    })
  } catch (transactionError) {
    return await reconcileOrCleanup(job, result, transactionError)
  }
  if (claimed) return true
  return await reconcileOrCleanup(job, result, new Error('EPISODE_PACKAGE_COMPLETION_CAS_LOST'))
}
