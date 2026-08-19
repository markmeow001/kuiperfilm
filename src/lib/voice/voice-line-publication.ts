import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { deleteCOSObject, getStorageObjectSize } from '@/lib/cos'
import { logError } from '@/lib/logging/core'
import { stablePublicIdFromStorageKey } from '@/lib/media/hash'
import { prisma } from '@/lib/prisma'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { TaskTerminatedError } from '@/lib/task/errors'
import { TASK_STATUS, TASK_TYPE, type TaskBillingInfo, type TaskJobData } from '@/lib/task/types'

const PUBLICATION_MARKER_KEY = 'voiceLinePublication'
const COMPLETION_CLAIM_KEY = 'voiceLineCompletionClaimId'
const ACTIVE_TASK_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] as const

export type VoiceLinePublicationInput = {
  speaker: string
  content: string
  voicePresetId: string | null
  emotionPrompt: string | null
  emotionStrength: number | null
  speakerVoices: string | null
  audioUrl: string | null
  audioMediaId: string | null
  audioDuration: number | null
}

export type VoiceLineTaskResult = {
  lineId: string
  audioUrl: string
  storageKey: string
  audioDuration: number | null
  actualCharacters?: number
}

export type VoiceLinePreparedOutput = {
  kind: 'voice_line_publication_v1'
  state: 'prepared' | 'deleted' | 'cleanup_failed'
  taskId: string
  projectId: string
  episodeId: string
  lineId: string
  sourceFingerprint: string
  outputUrl: string
  audioSha256: string
  audioBytes: number
  audioDuration: number | null
  input: VoiceLinePublicationInput
  result: VoiceLineTaskResult
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

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function nullableNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0)
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function nullableDuration(value: unknown): value is number | null {
  return value === null || nonNegativeInteger(value)
}

export function voiceLineStorageKey(
  job: Job<TaskJobData>,
  audioSha256: string,
): string {
  validateJobTuple(job)
  if (!isFingerprint(audioSha256)) {
    throw new Error('VOICE_LINE_AUDIO_FINGERPRINT_INVALID')
  }
  const taskKey = createHash('sha256').update(job.data.taskId).digest('hex').slice(0, 32)
  return `voice/${job.data.projectId}/${job.data.episodeId}/${job.data.targetId}/${taskKey}-${audioSha256}.wav`
}

function exactTaskWhere(job: Job<TaskJobData>) {
  return {
    id: job.data.taskId,
    userId: job.data.userId,
    projectId: job.data.projectId,
    episodeId: job.data.episodeId || null,
    type: TASK_TYPE.VOICE_LINE,
    targetType: 'NovelPromotionVoiceLine',
    targetId: job.data.targetId,
  }
}

function exactLineWhere(job: Job<TaskJobData>) {
  return {
    id: job.data.targetId,
    episodeId: job.data.episodeId!,
    episode: {
      novelPromotionProject: { projectId: job.data.projectId },
    },
  }
}

function validateJobTuple(job: Job<TaskJobData>): void {
  const taskId = typeof job.data.taskId === 'string' ? job.data.taskId.trim() : ''
  const projectId = typeof job.data.projectId === 'string' ? job.data.projectId.trim() : ''
  const episodeId = typeof job.data.episodeId === 'string' ? job.data.episodeId.trim() : ''
  const lineId = typeof job.data.targetId === 'string' ? job.data.targetId.trim() : ''
  const userId = typeof job.data.userId === 'string' ? job.data.userId.trim() : ''
  const jobId = typeof job.id === 'string' || typeof job.id === 'number' ? String(job.id) : ''
  const payload = isRecord(job.data.payload) ? job.data.payload : null
  if (
    !taskId
    || jobId !== taskId
    || !projectId
    || !episodeId
    || !lineId
    || !userId
    || job.data.type !== TASK_TYPE.VOICE_LINE
    || job.data.targetType !== 'NovelPromotionVoiceLine'
    || payload?.episodeId !== episodeId
    || payload?.lineId !== lineId
    || !isFingerprint(payload.sourceFingerprint)
  ) {
    throw new Error('VOICE_LINE_TASK_TARGET_INVALID')
  }
}

function parseInput(value: unknown): VoiceLinePublicationInput | null {
  if (
    !isRecord(value)
    || typeof value.speaker !== 'string'
    || value.speaker.length === 0
    || typeof value.content !== 'string'
    || value.content.length === 0
    || !nullableNonEmptyString(value.voicePresetId)
    || !nullableString(value.emotionPrompt)
    || !nullableFiniteNumber(value.emotionStrength)
    || !nullableString(value.speakerVoices)
    || !nullableString(value.audioUrl)
    || !nullableString(value.audioMediaId)
    || !nullableDuration(value.audioDuration)
  ) return null
  return {
    speaker: value.speaker,
    content: value.content,
    voicePresetId: value.voicePresetId,
    emotionPrompt: value.emotionPrompt,
    emotionStrength: value.emotionStrength,
    speakerVoices: value.speakerVoices,
    audioUrl: value.audioUrl,
    audioMediaId: value.audioMediaId,
    audioDuration: value.audioDuration,
  }
}

function parseTaskResult(value: unknown): VoiceLineTaskResult | null {
  if (
    !isRecord(value)
    || typeof value.lineId !== 'string'
    || value.lineId.length === 0
    || typeof value.audioUrl !== 'string'
    || value.audioUrl.length === 0
    || typeof value.storageKey !== 'string'
    || value.storageKey.length === 0
    || !nullableDuration(value.audioDuration)
    || (value.actualCharacters !== undefined && !nonNegativeInteger(value.actualCharacters))
  ) return null
  return {
    lineId: value.lineId,
    audioUrl: value.audioUrl,
    storageKey: value.storageKey,
    audioDuration: value.audioDuration,
    ...(typeof value.actualCharacters === 'number'
      ? { actualCharacters: value.actualCharacters }
      : {}),
  }
}

function sameTaskResult(left: unknown, right: VoiceLineTaskResult): boolean {
  const parsed = parseTaskResult(left)
  return !!parsed
    && parsed.lineId === right.lineId
    && parsed.audioUrl === right.audioUrl
    && parsed.storageKey === right.storageKey
    && parsed.audioDuration === right.audioDuration
    && parsed.actualCharacters === right.actualCharacters
}

function samePreparedOutput(
  left: VoiceLinePreparedOutput,
  right: VoiceLinePreparedOutput,
): boolean {
  return left.state === right.state
    && left.taskId === right.taskId
    && left.projectId === right.projectId
    && left.episodeId === right.episodeId
    && left.lineId === right.lineId
    && left.sourceFingerprint === right.sourceFingerprint
    && left.outputUrl === right.outputUrl
    && left.audioSha256 === right.audioSha256
    && left.audioBytes === right.audioBytes
    && left.audioDuration === right.audioDuration
    && JSON.stringify(left.input) === JSON.stringify(right.input)
    && sameTaskResult(left.result, right.result)
}

function samePublicationIdentity(
  left: VoiceLinePreparedOutput,
  right: VoiceLinePreparedOutput,
): boolean {
  const { state: _leftState, cleanupError: _leftCleanupError, ...leftIdentity } = left
  const { state: _rightState, cleanupError: _rightCleanupError, ...rightIdentity } = right
  return JSON.stringify(leftIdentity) === JSON.stringify(rightIdentity)
}

function assertTaskResultContext(
  job: Job<TaskJobData>,
  value: unknown,
): VoiceLineTaskResult {
  validateJobTuple(job)
  const result = parseTaskResult(value)
  if (
    !result
    || result.lineId !== job.data.targetId
    || result.storageKey !== expectedResultStorageKey(job, result.storageKey)
  ) {
    throw new Error('VOICE_LINE_RESULT_CONTEXT_INVALID')
  }
  return result
}

function expectedResultStorageKey(job: Job<TaskJobData>, storageKey: string): string | null {
  const taskHash = createHash('sha256').update(job.data.taskId).digest('hex').slice(0, 32)
  const prefix = `voice/${job.data.projectId}/${job.data.episodeId}/${job.data.targetId}/${taskHash}-`
  const match = storageKey.startsWith(prefix) && storageKey.endsWith('.wav')
    ? storageKey.slice(prefix.length, -'.wav'.length)
    : ''
  return isFingerprint(match) ? voiceLineStorageKey(job, match) : null
}

function parsePreparedOutput(value: unknown): VoiceLinePreparedOutput | null {
  if (!isRecord(value) || value.kind !== 'voice_line_publication_v1') return null
  const input = parseInput(value.input)
  const result = parseTaskResult(value.result)
  if (
    (value.state !== 'prepared' && value.state !== 'deleted' && value.state !== 'cleanup_failed')
    || typeof value.taskId !== 'string'
    || value.taskId.length === 0
    || typeof value.projectId !== 'string'
    || value.projectId.length === 0
    || typeof value.episodeId !== 'string'
    || value.episodeId.length === 0
    || typeof value.lineId !== 'string'
    || value.lineId.length === 0
    || !isFingerprint(value.sourceFingerprint)
    || typeof value.outputUrl !== 'string'
    || value.outputUrl.length === 0
    || !isFingerprint(value.audioSha256)
    || !nonNegativeInteger(value.audioBytes)
    || !nullableDuration(value.audioDuration)
    || !input
    || !result
    || result.lineId !== value.lineId
    || result.storageKey !== value.outputUrl
    || result.audioDuration !== value.audioDuration
  ) return null
  return {
    kind: 'voice_line_publication_v1',
    state: value.state,
    taskId: value.taskId,
    projectId: value.projectId,
    episodeId: value.episodeId,
    lineId: value.lineId,
    sourceFingerprint: value.sourceFingerprint,
    outputUrl: value.outputUrl,
    audioSha256: value.audioSha256,
    audioBytes: value.audioBytes,
    audioDuration: value.audioDuration,
    input,
    result,
    ...(typeof value.cleanupError === 'string' ? { cleanupError: value.cleanupError } : {}),
  }
}

function assertMarkerContext(
  job: Job<TaskJobData>,
  value: unknown,
): VoiceLinePreparedOutput {
  validateJobTuple(job)
  const marker = parsePreparedOutput(value)
  const submittedFingerprint = isRecord(job.data.payload)
    ? job.data.payload.sourceFingerprint
    : null
  if (
    !marker
    || marker.taskId !== job.data.taskId
    || marker.projectId !== job.data.projectId
    || marker.episodeId !== job.data.episodeId
    || marker.lineId !== job.data.targetId
    || marker.sourceFingerprint !== submittedFingerprint
    || marker.outputUrl !== voiceLineStorageKey(job, marker.audioSha256)
  ) {
    throw new Error('VOICE_LINE_PUBLICATION_MARKER_CONTEXT_INVALID')
  }
  return marker
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function reconciliationRequired(cause: unknown): Error {
  return Object.assign(
    new Error('VOICE_LINE_COMPLETION_RECONCILIATION_REQUIRED'),
    { code: 'EXTERNAL_ERROR', cause },
  )
}

function cleanupFailed(cause: unknown): Error {
  return Object.assign(
    new Error('VOICE_LINE_OUTPUT_CLEANUP_FAILED'),
    { code: 'EXTERNAL_ERROR', cause },
  )
}

export async function readVoiceLinePreparedOutput(
  job: Job<TaskJobData>,
): Promise<VoiceLinePreparedOutput | null> {
  validateJobTuple(job)
  const task = await prisma.task.findFirst({
    where: exactTaskWhere(job),
    select: { status: true, payload: true, result: true, finishedAt: true, errorCode: true },
  })
  if (!task) throw new Error('VOICE_LINE_TASK_SCOPE_MISMATCH')
  const payload = isRecord(task.payload) ? task.payload : {}
  const rawMarker = payload[PUBLICATION_MARKER_KEY]
  if (rawMarker === undefined || rawMarker === null) return null
  return assertMarkerContext(job, rawMarker)
}

export async function persistVoiceLinePreparedOutput(
  job: Job<TaskJobData>,
  value: VoiceLinePreparedOutput,
): Promise<void> {
  validateJobTuple(job)
  const marker = assertMarkerContext(job, value)
  if (marker.state !== 'prepared') {
    throw new Error('VOICE_LINE_PUBLICATION_MARKER_INVALID')
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const task = await prisma.task.findFirst({
      where: exactTaskWhere(job),
      select: { status: true, payload: true },
    })
    if (!task || (task.status !== TASK_STATUS.QUEUED && task.status !== TASK_STATUS.PROCESSING)) {
      throw new TaskTerminatedError(
        job.data.taskId,
        'Task terminated before voice line upload marker was stored',
      )
    }
    const payload = isRecord(task.payload) ? task.payload : {}
    const existingRaw = payload[PUBLICATION_MARKER_KEY]
    if (existingRaw !== undefined && existingRaw !== null) {
      const existing = assertMarkerContext(job, existingRaw)
      if (samePreparedOutput(existing, marker)) return
      throw new TaskTerminatedError(
        job.data.taskId,
        'Another processor already prepared the voice line output',
      )
    }
    const stored = await prisma.task.updateMany({
      where: {
        ...exactTaskWhere(job),
        status: { in: [...ACTIVE_TASK_STATUSES] },
        payload: { equals: toJson(payload) },
      },
      data: {
        payload: toJson({ ...payload, [PUBLICATION_MARKER_KEY]: marker }),
      },
    })
    if (stored.count === 1) return
  }
  throw Object.assign(new Error('VOICE_LINE_PUBLICATION_MARKER_CAS_RETRY_EXHAUSTED'), {
    code: 'EXTERNAL_ERROR',
  })
}

async function persistCleanupState(
  job: Job<TaskJobData>,
  taskPayload: unknown,
  marker: VoiceLinePreparedOutput,
  state: 'deleted' | 'cleanup_failed',
  error?: unknown,
): Promise<void> {
  const cleanupError = error instanceof Error ? error.message : error === undefined ? undefined : String(error)
  let currentPayload: unknown = taskPayload
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const payload = isRecord(currentPayload) ? currentPayload : {}
    const currentMarker = assertMarkerContext(job, payload[PUBLICATION_MARKER_KEY])
    if (!samePublicationIdentity(currentMarker, marker)) {
      throw new Error('VOICE_LINE_CLEANUP_MARKER_CHANGED')
    }
    if (currentMarker.state === state) {
      if (state === 'deleted' || currentMarker.cleanupError === cleanupError?.slice(0, 1000)) return
    }
    const { cleanupError: _previousCleanupError, ...markerWithoutCleanupError } = currentMarker
    const nextMarker: VoiceLinePreparedOutput = {
      ...markerWithoutCleanupError,
      state,
      ...(cleanupError ? { cleanupError: cleanupError.slice(0, 1000) } : {}),
    }
    const updated = await withPrismaRetry(() => prisma.task.updateMany({
      where: {
        ...exactTaskWhere(job),
        status: { in: [TASK_STATUS.FAILED, TASK_STATUS.DISMISSED] },
        payload: { equals: toJson(payload) },
      },
      data: {
        payload: toJson({ ...payload, [PUBLICATION_MARKER_KEY]: nextMarker }),
      },
    }), { maxRetries: 4, initialDelayMs: 50 })
    if (updated.count === 1) return

    const currentTask = await withPrismaRetry(() => prisma.task.findFirst({
      where: exactTaskWhere(job),
      select: { status: true, payload: true },
    }), { maxRetries: 4, initialDelayMs: 50 })
    if (
      !currentTask
      || (currentTask.status !== TASK_STATUS.FAILED && currentTask.status !== TASK_STATUS.DISMISSED)
    ) {
      throw new Error('VOICE_LINE_CLEANUP_STATE_PERSIST_FAILED')
    }
    currentPayload = currentTask.payload
  }
  throw new Error('VOICE_LINE_CLEANUP_STATE_PERSIST_FAILED')
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
    prisma.novelPromotionVoiceLine.findFirst({
      where: exactLineWhere(job),
      select: {
        audioUrl: true,
        audioMediaId: true,
        audioDuration: true,
      },
    }),
  ])
}

async function findVoiceLineOutputReference(outputUrl: string) {
  // Historical rows may retain `/m/<publicId>` in audioUrl without an
  // audioMediaId relation. Resolve the exact MediaObject first so the global
  // proof covers every representation accepted by the old write path.
  const media = await prisma.mediaObject.findUnique({
    where: { storageKey: outputUrl },
    select: { id: true, publicId: true },
  })
  // Publication never creates a MediaObject for a failed, unpublished output.
  // Any exact row therefore proves that another durable record may already
  // reference this object (including reverse relations outside VoiceLine).
  // Fail closed instead of trying to enumerate every current/future relation.
  if (media) return { id: `media:${media.id}` }

  const publicIds = new Set([stablePublicIdFromStorageKey(outputUrl)])
  const aliases = [...publicIds].map((publicId) => `/m/${encodeURIComponent(publicId)}`)
  return await prisma.novelPromotionVoiceLine.findFirst({
    where: {
      OR: [
        { audioUrl: outputUrl },
        { audioMedia: { is: { storageKey: outputUrl } } },
        ...aliases.flatMap((alias) => [
          { audioUrl: alias },
          { audioUrl: { startsWith: `${alias}?` } },
          { audioUrl: { startsWith: `${alias}#` } },
        ]),
      ],
    },
    select: { id: true },
  })
}

async function assertVoiceLineOutputUnreferenced(
  outputUrl: string,
  cause?: unknown,
): Promise<void> {
  let reference: Awaited<ReturnType<typeof findVoiceLineOutputReference>>
  try {
    reference = await findVoiceLineOutputReference(outputUrl)
  } catch (readError) {
    throw reconciliationRequired({ cause, readError, reason: 'global voice output reference read failed' })
  }
  if (reference) {
    throw reconciliationRequired({
      cause,
      reason: 'voice output is still referenced',
      referenceId: reference.id,
    })
  }
}

async function deleteExactVoiceLineOutput(
  job: Job<TaskJobData>,
  taskPayload: unknown,
  marker: VoiceLinePreparedOutput,
): Promise<void> {
  try {
    await deleteCOSObject(marker.outputUrl, { throwOnError: true })
  } catch (deleteError) {
    try {
      await persistCleanupState(job, taskPayload, marker, 'cleanup_failed', deleteError)
    } catch (persistError) {
      logError('voice line cleanup failure could not be persisted', {
        taskId: job.data.taskId,
        projectId: job.data.projectId,
        episodeId: job.data.episodeId,
        lineId: job.data.targetId,
        outputUrl: marker.outputUrl,
        deleteError: deleteError instanceof Error ? deleteError.message : String(deleteError),
        persistError: persistError instanceof Error ? persistError.message : String(persistError),
      })
      throw cleanupFailed({ deleteError, persistError })
    }
    throw cleanupFailed(deleteError)
  }

  if (marker.state === 'deleted') return
  try {
    await persistCleanupState(job, taskPayload, marker, 'deleted')
  } catch (persistError) {
    throw cleanupFailed({ reason: 'deleted marker persist failed', persistError })
  }
}

async function reconcileOrCleanup(
  job: Job<TaskJobData>,
  marker: VoiceLinePreparedOutput,
  cause?: unknown,
  completionClaimId?: string,
  options?: { verifyDeletedObject?: boolean },
): Promise<boolean> {
  let task: Awaited<ReturnType<typeof readScopedPublicationState>>[0]
  let line: Awaited<ReturnType<typeof readScopedPublicationState>>[1]
  try {
    ;[task, line] = await readScopedPublicationState(job)
  } catch (readError) {
    throw reconciliationRequired({ cause, readError })
  }
  if (!task) throw reconciliationRequired({ cause, reason: 'scoped task row missing' })
  if (
    task.status === TASK_STATUS.COMPLETED
    && !!task.finishedAt
    && sameTaskResult(task.result, marker.result)
    && !!line
    && line.audioUrl === marker.outputUrl
    && line.audioMediaId === null
    && line.audioDuration === marker.audioDuration
  ) {
    if (completionClaimId === undefined) return true
    const completedPayload = isRecord(task.payload) ? task.payload : {}
    return completedPayload[COMPLETION_CLAIM_KEY] === completionClaimId
  }

  const terminalWithoutReceipt = task.status === TASK_STATUS.FAILED
    || task.status === TASK_STATUS.DISMISSED
  if (!terminalWithoutReceipt) {
    throw reconciliationRequired({
      cause,
      taskStatus: task.status,
      linePointer: line?.audioUrl,
    })
  }

  const rawMarker = isRecord(task.payload) ? task.payload[PUBLICATION_MARKER_KEY] : null
  const durableMarker = assertMarkerContext(job, rawMarker)
  if (
    durableMarker.outputUrl !== marker.outputUrl
    || durableMarker.audioSha256 !== marker.audioSha256
    || durableMarker.audioBytes !== marker.audioBytes
  ) {
    throw reconciliationRequired({ cause, reason: 'durable publication marker mismatch' })
  }
  if (durableMarker.state === 'deleted') {
    if (!options?.verifyDeletedObject) return false
    await assertVoiceLineOutputUnreferenced(durableMarker.outputUrl, cause)
    let storedBytes: number | null
    try {
      storedBytes = await getStorageObjectSize(durableMarker.outputUrl)
    } catch (readError) {
      throw reconciliationRequired({
        cause,
        readError,
        reason: 'deleted tombstone storage verification failed',
      })
    }
    if (storedBytes === null) return false
    await deleteExactVoiceLineOutput(job, task.payload, durableMarker)
    return false
  }
  await assertVoiceLineOutputUnreferenced(durableMarker.outputUrl, cause)
  await deleteExactVoiceLineOutput(job, task.payload, durableMarker)
  return false
}

/**
 * Compensates a storage PUT that is known to have completed after the task's
 * post-upload cancellation fence failed. A prior terminal reconciler may have
 * already persisted a deleted tombstone while the PUT was still in flight, so
 * this path deliberately re-deletes that one exact durable key after a global
 * DB reread proves it has no VoiceLine reference.
 */
export async function reconcileVoiceLineLateUpload(
  job: Job<TaskJobData>,
  value: VoiceLinePreparedOutput,
): Promise<'deleted'> {
  validateJobTuple(job)
  const uploadedMarker = assertMarkerContext(job, value)
  const [task] = await readScopedPublicationState(job)
  if (!task) throw reconciliationRequired({ reason: 'late upload scoped task row missing' })
  if (task.status !== TASK_STATUS.FAILED && task.status !== TASK_STATUS.DISMISSED) {
    throw reconciliationRequired({
      reason: 'late upload task is not terminal',
      taskStatus: task.status,
    })
  }
  const payload = isRecord(task.payload) ? task.payload : {}
  const durableMarker = assertMarkerContext(job, payload[PUBLICATION_MARKER_KEY])
  if (!samePublicationIdentity(durableMarker, uploadedMarker)) {
    throw reconciliationRequired({ reason: 'late upload durable marker mismatch' })
  }
  await assertVoiceLineOutputUnreferenced(durableMarker.outputUrl)
  await deleteExactVoiceLineOutput(job, task.payload, durableMarker)
  return 'deleted'
}

/**
 * Completed tasks and active duplicate workers never delete output. Only a
 * failed/dismissed exact task with an exact durable marker may clean up, and
 * only after a project-scoped line reread proves that key is unreferenced.
 */
export async function reconcileVoiceLineTerminalState(
  job: Job<TaskJobData>,
  options?: { verifyDeletedObject?: boolean },
): Promise<'active' | 'published' | 'no_output' | 'deleted'> {
  validateJobTuple(job)
  let task: Awaited<ReturnType<typeof readScopedPublicationState>>[0]
  try {
    ;[task] = await readScopedPublicationState(job)
  } catch (readError) {
    throw reconciliationRequired({ reason: 'terminal scoped reread failed', readError })
  }
  if (!task) throw reconciliationRequired({ reason: 'terminal scoped task row missing' })
  if (task.status === TASK_STATUS.COMPLETED) return 'published'
  if (task.status === TASK_STATUS.QUEUED || task.status === TASK_STATUS.PROCESSING) return 'active'
  if (task.status !== TASK_STATUS.FAILED && task.status !== TASK_STATUS.DISMISSED) {
    throw reconciliationRequired({ reason: 'terminal task status unknown', taskStatus: task.status })
  }

  const rawMarker = isRecord(task.payload) ? task.payload[PUBLICATION_MARKER_KEY] : null
  if (rawMarker === undefined || rawMarker === null) return 'no_output'
  const marker = assertMarkerContext(job, rawMarker)
  return await reconcileOrCleanup(job, marker, undefined, undefined, options) ? 'published' : 'deleted'
}

export async function claimVoiceLineCompletion(
  job: Job<TaskJobData>,
  value: unknown,
  billing?: CompletionBilling,
): Promise<boolean> {
  const result = assertTaskResultContext(job, value)
  const taskBeforeClaim = await prisma.task.findFirst({
    where: exactTaskWhere(job),
    select: { status: true, payload: true, result: true, finishedAt: true, errorCode: true },
  })
  if (!taskBeforeClaim) throw new Error('VOICE_LINE_TASK_SCOPE_MISMATCH')
  const payload = isRecord(taskBeforeClaim.payload) ? taskBeforeClaim.payload : {}
  const marker = assertMarkerContext(job, payload[PUBLICATION_MARKER_KEY])
  if (marker.state !== 'prepared') {
    throw new Error('VOICE_LINE_PUBLICATION_MARKER_INVALID')
  }
  if (!sameTaskResult(marker.result, result)) {
    throw new Error('VOICE_LINE_RESULT_CONTEXT_INVALID')
  }
  const completionClaimId = randomUUID()
  const finishedAt = new Date()
  let claimed: boolean
  try {
    claimed = await prisma.$transaction(async (tx) => {
      const task = await tx.task.updateMany({
        where: {
          ...exactTaskWhere(job),
          status: { in: [...ACTIVE_TASK_STATUSES] },
          payload: { equals: toJson(payload) },
        },
        data: {
          status: TASK_STATUS.COMPLETED,
          progress: 100,
          result: toJson(result),
          finishedAt,
          heartbeatAt: null,
          payload: toJson({ ...payload, [COMPLETION_CLAIM_KEY]: completionClaimId }),
          ...(billing?.billingInfo !== undefined
            ? { billingInfo: billing.billingInfo === null ? Prisma.JsonNull : toJson(billing.billingInfo) }
            : {}),
          ...(billing?.billedAt !== undefined ? { billedAt: billing.billedAt } : {}),
        },
      })
      if (task.count !== 1) return false

      const line = await tx.novelPromotionVoiceLine.updateMany({
        where: {
          id: marker.lineId,
          episodeId: marker.episodeId,
          speaker: marker.input.speaker,
          content: marker.input.content,
          voicePresetId: marker.input.voicePresetId,
          emotionPrompt: marker.input.emotionPrompt,
          emotionStrength: marker.input.emotionStrength,
          audioUrl: marker.input.audioUrl,
          audioMediaId: marker.input.audioMediaId,
          audioDuration: marker.input.audioDuration,
          episode: {
            speakerVoices: marker.input.speakerVoices,
            novelPromotionProject: { projectId: marker.projectId },
          },
        },
        data: {
          audioUrl: marker.outputUrl,
          audioMediaId: null,
          audioDuration: marker.audioDuration,
        },
      })
      if (line.count !== 1) {
        throw new Error('VOICE_LINE_INPUT_OR_PROJECT_SCOPE_MISMATCH')
      }
      return true
    })
  } catch (transactionError) {
    return await reconcileOrCleanup(job, marker, transactionError, completionClaimId)
  }
  if (claimed) return true
  return await reconcileOrCleanup(
    job,
    marker,
    new Error('VOICE_LINE_COMPLETION_CAS_LOST'),
    completionClaimId,
  )
}
