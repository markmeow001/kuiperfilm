import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { rollbackTaskBilling } from '@/lib/billing'
import { locales } from '@/i18n/routing'
import { TASK_STATUS, type CreateTaskInput, type TaskBillingInfo, type TaskStatus } from './types'
import type { JobStatusFilter } from './job-view'
import type { VoiceLineRecoveryTask } from './voice-line-job-recovery'
import {
  classifyPaidVoiceProviderHandoff,
  isPaidVoiceProviderTaskType,
  isProtectedVoiceLineProviderHandoff,
  isSafelyTerminalPaidVoiceProviderFailure,
  paidVoiceProviderTerminalErrorCode,
  type PaidVoiceProviderHandoffClassification,
  type PaidVoiceProviderTerminalStatus,
} from './voice-line-recovery-policy'

const ACTIVE_STATUSES: TaskStatus[] = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]
const taskModel = prisma.task

/**
 * 校验 BullMQ Job 是否仍然活着。
 * 检查失败时（如 Redis 不可用）安全降级为 true，不阻塞正常创建流程。
 */
async function verifyJobAlive(taskId: string): Promise<boolean> {
  try {
    const { isJobAlive } = await import('./reconcile')
    return await isJobAlive(taskId)
  } catch {
    // Redis 异常等不可控情况 → 降级信任 DB 状态
    return true
  }
}

async function recoverVoiceLineQueueLossIfProtected(
  task: VoiceLineRecoveryTask,
): Promise<boolean> {
  if (!isProtectedVoiceLineProviderHandoff(task)) return false
  const recovery = await import('./voice-line-job-recovery')
  try {
    await recovery.recoverMissingVoiceLineJob(task)
  } catch {
    // A non-empty paid-provider handoff is authoritative even when recovery
    // infrastructure is temporarily unavailable. Fail closed: keep the same
    // Task/dedupe/billing reservation so no later worker submits a second POST.
  }
  return true
}

function isPrismaKnownError(error: unknown): error is { code?: string } {
  return typeof error === 'object' && error !== null && 'code' in error
}

function isActiveStatus(status: string) {
  return status === TASK_STATUS.QUEUED || status === TASK_STATUS.PROCESSING
}

function voiceLineNoProviderHandoffWhere(task: { type: string }): Prisma.TaskWhereInput | undefined {
  return isPaidVoiceProviderTaskType(task.type)
    ? { OR: [{ externalId: null }, { externalId: '' }] }
    : undefined
}

function isUnresolvedVoiceLineProviderHandoff(task: {
  type: string
  status: string
  externalId: string | null
  errorCode?: string | null
}) {
  return task.status !== TASK_STATUS.COMPLETED
    && !isSafelyTerminalPaidVoiceProviderFailure(task)
    && isProtectedVoiceLineProviderHandoff(task)
}

export type PaidVoiceProviderHandoffSnapshot = {
  status: string
  progress: number
  handoff: PaidVoiceProviderHandoffClassification
}

export async function getPaidVoiceProviderHandoffSnapshot(
  taskId: string,
  expectedTaskType: string,
): Promise<PaidVoiceProviderHandoffSnapshot | null> {
  if (!taskId || !isPaidVoiceProviderTaskType(expectedTaskType)) return null
  const task = await taskModel.findUnique({
    where: { id: taskId },
    select: {
      type: true,
      status: true,
      progress: true,
      externalId: true,
    },
  })
  if (!task || task.type !== expectedTaskType) return null
  return {
    status: task.status,
    progress: task.progress,
    handoff: classifyPaidVoiceProviderHandoff(task),
  }
}

export async function tryMarkPaidVoiceProviderTerminalFailure(params: {
  taskId: string
  expectedTaskType: string
  externalId: string
  terminalStatus: PaidVoiceProviderTerminalStatus
  errorMessage: string
}): Promise<boolean> {
  const snapshot = await getPaidVoiceProviderHandoffSnapshot(
    params.taskId,
    params.expectedTaskType,
  )
  if (
    !snapshot
    || snapshot.handoff.kind !== 'actual'
    || snapshot.handoff.externalId !== params.externalId
  ) return false

  const result = await taskModel.updateMany({
    where: {
      id: params.taskId,
      type: params.expectedTaskType,
      status: { in: [...ACTIVE_STATUSES] },
      externalId: params.externalId,
    },
    data: {
      status: TASK_STATUS.FAILED,
      errorCode: paidVoiceProviderTerminalErrorCode(params.terminalStatus),
      errorMessage: params.errorMessage.slice(0, 2000),
      finishedAt: new Date(),
      heartbeatAt: null,
      // VoiceLine and Canvas TTS keys identify one immutable HTTP attempt.
      // Retain the key even for an explicit provider terminal negative: the
      // original HTTP acknowledgement may have been lost, so replaying its
      // clientRequestId must still resolve to this exact auditable Task.
    },
  })
  return result.count === 1
}

export async function tryMarkPaidVoiceTaskFailedBeforeProviderHandoff(params: {
  taskId: string
  expectedTaskType: string
  errorCode: string
  errorMessage: string
}): Promise<boolean> {
  if (!params.taskId || !isPaidVoiceProviderTaskType(params.expectedTaskType)) return false
  const result = await taskModel.updateMany({
    where: {
      id: params.taskId,
      type: params.expectedTaskType,
      status: { in: [...ACTIVE_STATUSES] },
      OR: [{ externalId: null }, { externalId: '' }],
    },
    data: {
      status: TASK_STATUS.FAILED,
      errorCode: params.errorCode.slice(0, 80),
      errorMessage: params.errorMessage.slice(0, 2000),
      finishedAt: new Date(),
      heartbeatAt: null,
    },
  })
  return result.count === 1
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function idempotencyFingerprint(value: unknown): string | null {
  const payload = toObject(value)
  const fingerprint = typeof payload.idempotencyFingerprint === 'string'
    ? payload.idempotencyFingerprint.trim()
    : ''
  return fingerprint || null
}

function assertIdempotentPayloadMatches(existingPayload: unknown, requestedPayload: unknown): void {
  const requested = idempotencyFingerprint(requestedPayload)
  if (!requested) return
  if (idempotencyFingerprint(existingPayload) === requested) return
  throw Object.assign(new Error('TASK_IDEMPOTENCY_CONFLICT'), {
    code: 'CONFLICT' as const,
    status: 409,
    details: { code: 'TASK_IDEMPOTENCY_CONFLICT' },
  })
}

function taskAdmissionConflict(): never {
  throw Object.assign(new Error('VOICE_LINE_GENERATION_IN_PROGRESS'), {
    code: 'CONFLICT' as const,
    status: 409,
    details: { code: 'VOICE_LINE_GENERATION_IN_PROGRESS' },
  })
}

function reuseTaskOrRejectForeignAdmission<TTask extends { id: string }>(
  input: CreateTaskInput,
  task: TTask,
): { task: TTask; deduped: true } {
  if (input.idempotencyTaskId && task.id !== input.idempotencyTaskId) {
    taskAdmissionConflict()
  }
  return { task, deduped: true }
}

/**
 * Read-only all-or-none preflight for a bounded group of idempotent submits.
 * This prevents a known conflict on one existing key from being discovered
 * only after sibling submissions have already frozen billing and queued work.
 * DB uniqueness remains the final concurrency fence inside createTask.
 */
export async function assertIdempotentTaskBatchPreflight(
  requests: Array<{
    idempotencyTaskId: string
    dedupeKey: string
    payload: Record<string, unknown>
  }>,
): Promise<void> {
  if (requests.length === 0) return

  const requestedById = new Map<string, Record<string, unknown>>()
  const requestedByDedupeKey = new Map<string, string>()
  for (const request of requests) {
    const prior = requestedById.get(request.idempotencyTaskId)
    if (prior) assertIdempotentPayloadMatches(prior, request.payload)
    requestedById.set(request.idempotencyTaskId, request.payload)
    const priorTaskId = requestedByDedupeKey.get(request.dedupeKey)
    if (priorTaskId && priorTaskId !== request.idempotencyTaskId) {
      taskAdmissionConflict()
    }
    requestedByDedupeKey.set(request.dedupeKey, request.idempotencyTaskId)
  }

  const existing = await taskModel.findMany({
    where: {
      OR: [
        { id: { in: [...requestedById.keys()] } },
        { dedupeKey: { in: [...requestedByDedupeKey.keys()] } },
      ],
    },
    select: {
      id: true,
      type: true,
      status: true,
      dedupeKey: true,
      externalId: true,
      errorCode: true,
      payload: true,
    },
  })
  for (const task of existing) {
    const requested = requestedById.get(task.id)
    if (requested) assertIdempotentPayloadMatches(task.payload, requested)
    if (!task.dedupeKey) continue
    const requestedTaskId = requestedByDedupeKey.get(task.dedupeKey)
    if (
      requestedTaskId
      && requestedTaskId !== task.id
      && (isActiveStatus(task.status) || isUnresolvedVoiceLineProviderHandoff(task))
    ) {
      taskAdmissionConflict()
    }
  }
}

function normalizeLocale(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  for (const locale of locales) {
    if (normalized === locale || normalized.startsWith(`${locale}-`)) {
      return locale
    }
  }
  return null
}

function hasTaskLocale(payload: unknown): boolean {
  const payloadObject = toObject(payload)
  const payloadMeta = toObject(payloadObject.meta)
  const locale = normalizeLocale(payloadMeta.locale) || normalizeLocale(payloadObject.locale)
  return locale !== null
}

function toNullableJson(value?: Prisma.InputJsonValue | Record<string, unknown> | TaskBillingInfo | null) {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value as Prisma.InputJsonValue
}

function parseTaskBillingInfo(raw: unknown): TaskBillingInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!('billable' in raw)) return null
  const billable = (raw as { billable?: unknown }).billable
  if (typeof billable !== 'boolean') return null
  return raw as TaskBillingInfo
}

function needsRollback(info: TaskBillingInfo | null): info is Extract<TaskBillingInfo, { billable: true }> {
  if (!info || !info.billable) return false
  if (!info.freezeId) return false
  if (info.modeSnapshot === 'OFF' || info.modeSnapshot === 'SHADOW') return false
  if (info.status === 'settled' || info.status === 'rolled_back') return false
  return true
}

type TaskBillingRollbackResult = {
  attempted: boolean
  rolledBack: boolean
  billingInfo: TaskBillingInfo | null
}

async function failTaskWithMissingLocale(task: {
  id: string
  type: string
}) {
  return await claimTaskFailureAndRollback({
    taskId: task.id,
    errorCode: 'TASK_LOCALE_REQUIRED',
    errorMessage: 'task locale is missing',
    clearDedupeKey: true,
    extraWhere: voiceLineNoProviderHandoffWhere(task),
  })
}

export async function rollbackTaskBillingForTask(params: {
  taskId: string
  billingInfo?: unknown
}): Promise<TaskBillingRollbackResult> {
  const current =
    params.billingInfo === undefined
      ? await taskModel.findUnique({
        where: { id: params.taskId },
        select: { billingInfo: true },
      })
      : { billingInfo: params.billingInfo }

  const billingInfo = parseTaskBillingInfo(current?.billingInfo ?? null)
  if (!needsRollback(billingInfo)) {
    return {
      attempted: false,
      rolledBack: true,
      billingInfo,
    }
  }

  const nextInfo = (await rollbackTaskBilling({
    id: params.taskId,
    billingInfo,
  })) as TaskBillingInfo

  await updateTaskBillingInfo(params.taskId, nextInfo)

  return {
    attempted: true,
    rolledBack: nextInfo.billable ? nextInfo.status === 'rolled_back' : true,
    billingInfo: nextInfo,
  }
}

async function claimTaskFailureAndRollback(params: {
  taskId: string
  errorCode: string
  errorMessage: string
  clearDedupeKey?: boolean
  extraWhere?: Prisma.TaskWhereInput
  billingInfo?: unknown
}): Promise<{ claimed: boolean; rollback: TaskBillingRollbackResult }> {
  const updated = await taskModel.updateMany({
    where: {
      id: params.taskId,
      status: { in: [...ACTIVE_STATUSES] },
      ...(params.extraWhere ? { AND: [params.extraWhere] } : {}),
    },
    data: {
      status: TASK_STATUS.FAILED,
      errorCode: params.errorCode.slice(0, 80),
      errorMessage: params.errorMessage.slice(0, 2000),
      finishedAt: new Date(),
      heartbeatAt: null,
      ...(params.clearDedupeKey ? { dedupeKey: null } : {}),
    },
  })

  if (updated.count === 0) {
    return {
      claimed: false,
      rollback: { attempted: false, rolledBack: true, billingInfo: null },
    }
  }

  // Read the billing snapshot only after winning the lifecycle CAS. A worker
  // that lost this same active -> terminal race must never settle or refund it.
  const rollback = await rollbackTaskBillingForTask({
    taskId: params.taskId,
    ...(params.billingInfo === undefined ? {} : { billingInfo: params.billingInfo }),
  })
  return { claimed: true, rollback }
}

export async function failActiveTaskAndRollback(params: {
  taskId: string
  errorCode: string
  errorMessage: string
  clearDedupeKey?: boolean
  billingInfo?: unknown
}) {
  return await claimTaskFailureAndRollback(params)
}

export async function createTask(input: CreateTaskInput) {
  const model = taskModel

  // HTTP replay identity is deliberately independent from the target's active
  // admission key. A completed Task may have released dedupeKey so a new
  // request can regenerate the line, while a replay of the old UUID must still
  // resolve to its exact historical row and must never bill/enqueue again.
  if (input.idempotencyTaskId) {
    const exactReplay = await model.findUnique({
      where: { id: input.idempotencyTaskId },
    })
    if (exactReplay) {
      assertIdempotentPayloadMatches(exactReplay.payload, input.payload)
      return { task: exactReplay, deduped: true as const }
    }
  }

  if (input.dedupeKey) {
    const existing = await model.findFirst({
      where: {
        dedupeKey: input.dedupeKey,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      // HTTP idempotency keys identify one immutable attempt. Reuse the first
      // DB row regardless of lifecycle state so overlapping requests cannot
      // both bill/enqueue, and a lost response can replay the terminal result.
      if (input.dedupeMode === 'idempotent') {
        assertIdempotentPayloadMatches(existing.payload, input.payload)
        return reuseTaskOrRejectForeignAdmission(input, existing)
      }
      if (isActiveStatus(existing.status)) {
        if (!hasTaskLocale(existing.payload)) {
          if (await recoverVoiceLineQueueLossIfProtected(existing)) {
            return reuseTaskOrRejectForeignAdmission(input, existing)
          }
          const localeClaim = await failTaskWithMissingLocale(existing)
          if (!localeClaim.claimed && isPaidVoiceProviderTaskType(existing.type)) {
            const authoritative = await model.findFirst({
              where: { dedupeKey: input.dedupeKey },
              orderBy: { createdAt: 'desc' },
            })
            if (
              authoritative
              && (isActiveStatus(authoritative.status)
                || isUnresolvedVoiceLineProviderHandoff(authoritative))
            ) {
              return reuseTaskOrRejectForeignAdmission(input, authoritative)
            }
          }
        } else {
          // 校验 BullMQ Job 是否真的还活着，防止 DB 与队列状态脱节导致永久卡死
          const jobAlive = await verifyJobAlive(existing.id)
          if (jobAlive) {
            return reuseTaskOrRejectForeignAdmission(input, existing)
          }

          if (await recoverVoiceLineQueueLossIfProtected(existing)) {
            return reuseTaskOrRejectForeignAdmission(input, existing)
          }

          const orphanClaim = await claimTaskFailureAndRollback({
            taskId: existing.id,
            errorCode: 'RECONCILE_ORPHAN',
            errorMessage: 'Queue job lost, replaced by new task',
            clearDedupeKey: true,
            extraWhere: voiceLineNoProviderHandoffWhere(existing),
          })
          if (!orphanClaim.claimed && isPaidVoiceProviderTaskType(existing.type)) {
            const authoritative = await model.findFirst({
              where: { dedupeKey: input.dedupeKey },
              orderBy: { createdAt: 'desc' },
            })
            if (
              authoritative
              && (isActiveStatus(authoritative.status)
                || isUnresolvedVoiceLineProviderHandoff(authoritative))
            ) {
              return reuseTaskOrRejectForeignAdmission(input, authoritative)
            }
          }
        }
      } else {
        // A terminal VoiceLine row can still represent an unresolved paid
        // provider handoff (actual request id, submit claim, or malformed
        // non-empty checkpoint). Releasing its unique key would permit a new
        // Task to POST again while the first provider request may still bill.
        if (isUnresolvedVoiceLineProviderHandoff(existing)) {
          return reuseTaskOrRejectForeignAdmission(input, existing)
        }
        // dedupeKey is unique in DB. Release terminal-task key so a new task can be created.
        await model.update({
          where: { id: existing.id },
          data: { dedupeKey: null },
        })
      }
    }
  }

  const createData = {
    ...(input.idempotencyTaskId ? { id: input.idempotencyTaskId } : {}),
    userId: input.userId,
    projectId: input.projectId,
    episodeId: input.episodeId || null,
    type: input.type,
    targetType: input.targetType,
    targetId: input.targetId,
    status: TASK_STATUS.QUEUED,
    progress: 0,
    attempt: 0,
    maxAttempts: input.maxAttempts ?? 5,
    priority: input.priority ?? 0,
    dedupeKey: input.dedupeKey || null,
    payload: toNullableJson(input.payload ?? null),
    billingInfo: toNullableJson(input.billingInfo ?? null),
    queuedAt: new Date(),
  }

  try {
    const task = await model.create({ data: createData })
    return { task, deduped: false as const }
  } catch (error: unknown) {
    if (input.dedupeKey && isPrismaKnownError(error) && error.code === 'P2002') {
      // P2002 may be either the immutable Task.id or the active target key.
      // Always re-read the exact HTTP identity first: the same request can
      // lose its create acknowledgement after the winner already completed
      // and released the target lock.
      if (input.idempotencyTaskId) {
        const exactReplay = await model.findUnique({
          where: { id: input.idempotencyTaskId },
        })
        if (exactReplay) {
          assertIdempotentPayloadMatches(exactReplay.payload, input.payload)
          return { task: exactReplay, deduped: true as const }
        }
      }

      const collided = await model.findFirst({
        where: { dedupeKey: input.dedupeKey },
        orderBy: { createdAt: 'desc' },
      })

      if (collided) {
        // The unique DB constraint is the atomic winner for concurrent HTTP
        // retries. In idempotent mode the losing request must reuse that row,
        // even if the first request completed before this lookup.
        if (input.dedupeMode === 'idempotent') {
          assertIdempotentPayloadMatches(collided.payload, input.payload)
          return reuseTaskOrRejectForeignAdmission(input, collided)
        }
        if (isActiveStatus(collided.status)) {
          if (!hasTaskLocale(collided.payload)) {
            if (await recoverVoiceLineQueueLossIfProtected(collided)) {
              return reuseTaskOrRejectForeignAdmission(input, collided)
            }
            const localeClaim = await failTaskWithMissingLocale(collided)
            if (!localeClaim.claimed && isPaidVoiceProviderTaskType(collided.type)) {
              const authoritative = await model.findFirst({
                where: { dedupeKey: input.dedupeKey },
                orderBy: { createdAt: 'desc' },
              })
              if (
                authoritative
                && (isActiveStatus(authoritative.status)
                  || isUnresolvedVoiceLineProviderHandoff(authoritative))
              ) {
                  return reuseTaskOrRejectForeignAdmission(input, authoritative)
              }
            }
          } else {
            // P2002 竞态路径：同样校验 BullMQ Job 状态
            const jobAlive = await verifyJobAlive(collided.id)
            if (jobAlive) {
              return reuseTaskOrRejectForeignAdmission(input, collided)
            }

            if (await recoverVoiceLineQueueLossIfProtected(collided)) {
              return reuseTaskOrRejectForeignAdmission(input, collided)
            }

            const orphanClaim = await claimTaskFailureAndRollback({
              taskId: collided.id,
              errorCode: 'RECONCILE_ORPHAN',
              errorMessage: 'Queue job lost, replaced by new task',
              clearDedupeKey: true,
              extraWhere: voiceLineNoProviderHandoffWhere(collided),
            })
            if (!orphanClaim.claimed) {
              const authoritative = await model.findFirst({
                where: { dedupeKey: input.dedupeKey },
                orderBy: { createdAt: 'desc' },
              })
              if (
                authoritative
                && (isActiveStatus(authoritative.status)
                  || isUnresolvedVoiceLineProviderHandoff(authoritative))
              ) {
                return reuseTaskOrRejectForeignAdmission(input, authoritative)
              }
              // The worker may have reached a terminal state between the queue
              // probe and our CAS. Release only a terminal row's dedupe key;
              // never overwrite its lifecycle or touch its billing.
              await model.updateMany({
                where: {
                  id: authoritative?.id ?? collided.id,
                  status: { notIn: [...ACTIVE_STATUSES] },
                },
                data: { dedupeKey: null },
              })
            }
          }
        } else {
          if (isUnresolvedVoiceLineProviderHandoff(collided)) {
            return reuseTaskOrRejectForeignAdmission(input, collided)
          }
          await model.update({
            where: { id: collided.id },
            data: { dedupeKey: null },
          })
        }

        const task = await model.create({ data: createData })
        return { task, deduped: false as const }
      }
    }

    throw error
  }
}

export async function getTaskById(taskId: string) {
  return await taskModel.findUnique({ where: { id: taskId } })
}

export async function queryTasks(filters: {
  userId?: string
  projectId?: string
  episodeId?: string
  targetType?: string
  targetId?: string
  status?: TaskStatus[]
  jobStatus?: JobStatusFilter[]
  type?: string[]
  cursor?: string
  limit?: number
}) {
  const jobStatusConditions: Prisma.TaskWhereInput[] = []
  for (const status of filters.jobStatus || []) {
    if (status === 'active') {
      jobStatusConditions.push({ status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] } })
    } else if (status === 'completed') {
      jobStatusConditions.push({ status: TASK_STATUS.COMPLETED })
    } else if (status === 'cancelled') {
      jobStatusConditions.push({ status: TASK_STATUS.FAILED, errorCode: 'TASK_CANCELLED' })
    } else if (status === 'failed') {
      jobStatusConditions.push({
        status: TASK_STATUS.FAILED,
        OR: [
          { errorCode: null },
          { errorCode: { not: 'TASK_CANCELLED' } },
        ],
      })
    }
  }

  return await taskModel.findMany({
    where: {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.episodeId ? { episodeId: filters.episodeId } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.targetId ? { targetId: filters.targetId } : {}),
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(jobStatusConditions.length ? { AND: [{ OR: jobStatusConditions }] } : {}),
      ...(filters.type?.length ? { type: { in: filters.type } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    take: filters.limit ?? 50,
  })
}

export async function getActiveTasksForTarget(params: {
  targetType: string
  targetId: string
  projectId?: string
}) {
  return await taskModel.findMany({
    where: {
      targetType: params.targetType,
      targetId: params.targetId,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      status: { in: [...ACTIVE_STATUSES] },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function markTaskEnqueueFailed(taskId: string, error: string) {
  return await taskModel.update({
    where: { id: taskId },
    data: {
      enqueueAttempts: { increment: 1 },
      lastEnqueueError: error.slice(0, 500),
    },
  })
}

export async function markTaskEnqueued(taskId: string) {
  return await taskModel.update({
    where: { id: taskId },
    data: {
      enqueuedAt: new Date(),
      lastEnqueueError: null,
    },
  })
}

export async function updateTaskBillingInfo(
  taskId: string,
  billingInfo: TaskBillingInfo | null,
  options?: { billedAt?: Date | null },
) {
  return await taskModel.update({
    where: { id: taskId },
    data: {
      billingInfo: toNullableJson(billingInfo as unknown as Prisma.InputJsonValue),
      ...(options?.billedAt !== undefined ? { billedAt: options.billedAt } : {}),
    },
  })
}

export async function tryUpdateActiveTaskBillingInfo(
  taskId: string,
  billingInfo: TaskBillingInfo | null,
) {
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: {
      billingInfo: toNullableJson(billingInfo as unknown as Prisma.InputJsonValue),
    },
  })
  return result.count > 0
}

/**
 * Read existing task.payload, deep-merge meta sub-object so callers that
 * only know "their slice" of meta don't blow away unrelated meta keys
 * (locale, route, userTier, runId, provider, etc.) written by upstream
 * layers. Callers may additionally preserve existing top-level fields when
 * writing runtime progress: the standalone watchdog rebuilds stalled jobs
 * from this payload, so prompt/model/media/audio contracts must survive.
 *
 * Adds one DB read per call; only callers that pass non-null payload
 * pay it.
 */
async function mergePayloadMetaWithExisting(
  taskId: string | undefined | null,
  payload: Record<string, unknown> | null,
  options?: { preserveExistingTopLevel?: boolean },
): Promise<Record<string, unknown> | null> {
  if (!payload) return payload
  // Defensive: a job without a taskId has no Task row to merge against, so
  // skip the meta-merge read entirely. (Pre-9.1 this guarded the bespoke
  // playground path; post-9.1 playground rides the Task spine and always has
  // a taskId, but the null-guard stays as general safety.)
  if (!taskId) return payload
  const existing = await taskModel.findUnique({
    where: { id: taskId },
    select: { payload: true },
  })
  const existingPayload =
    existing?.payload && typeof existing.payload === 'object' && !Array.isArray(existing.payload)
      ? (existing.payload as Record<string, unknown>)
      : {}
  const existingMeta =
    existingPayload.meta && typeof existingPayload.meta === 'object' && !Array.isArray(existingPayload.meta)
      ? (existingPayload.meta as Record<string, unknown>)
      : {}
  const incomingMeta =
    payload.meta && typeof payload.meta === 'object' && !Array.isArray(payload.meta)
      ? (payload.meta as Record<string, unknown>)
      : {}
  return {
    ...(options?.preserveExistingTopLevel ? existingPayload : {}),
    ...payload,
    meta: { ...existingMeta, ...incomingMeta },
  }
}

export async function updateTaskPayload(
  taskId: string | undefined | null,
  payload: Record<string, unknown> | null,
  options?: { preserveExistingTopLevel?: boolean },
) {
  // Defensive null-guard: nothing to update without a Task row. (Post-9.1
  // playground rides the Task spine and always has one.)
  if (!taskId) return null
  const merged = await mergePayloadMetaWithExisting(taskId, payload, options)
  return await taskModel.update({
    where: { id: taskId },
    data: {
      payload: toNullableJson(merged as unknown as Prisma.InputJsonValue),
    },
  })
}

function activeTaskWhere(taskId: string) {
  return {
    id: taskId,
    status: { in: [...ACTIVE_STATUSES] },
  }
}

export async function isTaskActive(taskId: string | undefined | null) {
  // Defensive: a job without a taskId has no Task-cancellation concept, so
  // treat it as active and let it proceed. findUnique({ where: { id:
  // undefined } }) would otherwise throw "needs at least one of id or
  // dedupeKey" and kill the job. (Pre-9.1 this covered the bespoke playground
  // path; post-9.1 playground rides the Task spine and always has a taskId.)
  if (!taskId) return true
  const task = await withPrismaRetry(() =>
    taskModel.findUnique({
      where: { id: taskId },
      select: { status: true },
    })
  )
  if (!task) return false
  return isActiveStatus(task.status)
}

export async function tryMarkTaskProcessing(taskId: string | undefined | null, externalId?: string | null) {
  if (!taskId) return false
  const externalIdUpdate = externalId === undefined
    ? {}
    : { externalId: typeof externalId === 'string' && externalId.trim() ? externalId.trim() : null }
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: {
      status: TASK_STATUS.PROCESSING,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      ...externalIdUpdate,
      attempt: { increment: 1 },
    },
  })
  return result.count > 0
}

export async function trySetTaskExternalId(taskId: string | undefined | null, externalId: string) {
  if (!taskId) return false
  const value = typeof externalId === 'string' ? externalId.trim() : ''
  if (!value) return false
  const result = await taskModel.updateMany({
    where: {
      ...activeTaskWhere(taskId),
      OR: [
        { externalId: null },
        { externalId: '' },
      ],
    },
    data: {
      externalId: value,
    },
  })
  return result.count > 0
}

/**
 * Durable provider hand-off for paid asynchronous tasks.
 *
 * Once a provider has accepted a request, losing its external id opens a
 * duplicate-charge window on queue retry. This helper therefore retries
 * transient database failures and only returns after the exact id is known to
 * be stored. A false conditional update is accepted only when another worker
 * already persisted the same id; every other outcome fails loudly.
 */
export async function persistTaskExternalIdOrThrow(
  taskId: string | undefined | null,
  externalId: string,
): Promise<void> {
  const value = typeof externalId === 'string' ? externalId.trim() : ''
  if (!taskId || !value) {
    throw new Error('TASK_EXTERNAL_ID_PERSIST_INPUT_INVALID')
  }

  const stored = await withPrismaRetry(
    () => trySetTaskExternalId(taskId, value),
    { maxRetries: 4, initialDelayMs: 100 },
  )
  if (stored) return

  const current = await withPrismaRetry(() => taskModel.findUnique({
    where: { id: taskId },
    select: { externalId: true },
  }), { maxRetries: 4, initialDelayMs: 100 })
  if (current?.externalId?.trim() === value) return

  throw new Error('TASK_EXTERNAL_ID_PERSIST_FAILED')
}

/**
 * Atomically claims the right to submit one paid provider request. The claim
 * is stored in the same unique Task row that owns billing, so overlapping
 * BullMQ processors cannot both pass a read-then-submit window.
 */
export async function claimTaskExternalId(
  taskId: string | undefined | null,
  claimId: string,
): Promise<{ claimed: boolean; externalId: string | null }> {
  const value = typeof claimId === 'string' ? claimId.trim() : ''
  if (!taskId || !value) throw new Error('TASK_EXTERNAL_ID_CLAIM_INPUT_INVALID')

  const claimed = await withPrismaRetry(
    () => trySetTaskExternalId(taskId, value),
    { maxRetries: 4, initialDelayMs: 100 },
  )
  if (claimed) return { claimed: true, externalId: value }

  const current = await withPrismaRetry(() => taskModel.findUnique({
    where: { id: taskId },
    select: { externalId: true },
  }), { maxRetries: 4, initialDelayMs: 100 })
  return { claimed: false, externalId: current?.externalId?.trim() || null }
}

/**
 * Replaces an exact provider-submit claim with the provider request id. This
 * intentionally does not require an active status: cancellation may win after
 * the provider accepted the request, but the request id must still remain
 * durable for audit/reconciliation and must never be lost.
 */
export async function replaceTaskExternalIdOrThrow(
  taskId: string | undefined | null,
  expectedExternalId: string,
  nextExternalId: string,
): Promise<void> {
  const expected = typeof expectedExternalId === 'string' ? expectedExternalId.trim() : ''
  const next = typeof nextExternalId === 'string' ? nextExternalId.trim() : ''
  if (!taskId || !expected || !next) throw new Error('TASK_EXTERNAL_ID_REPLACE_INPUT_INVALID')

  const replaced = await withPrismaRetry(() => taskModel.updateMany({
    where: { id: taskId, externalId: expected },
    data: { externalId: next },
  }), { maxRetries: 4, initialDelayMs: 100 })
  if (replaced.count === 1) return

  const current = await withPrismaRetry(() => taskModel.findUnique({
    where: { id: taskId },
    select: { externalId: true },
  }), { maxRetries: 4, initialDelayMs: 100 })
  if (current?.externalId?.trim() === next) return
  throw new Error('TASK_EXTERNAL_ID_REPLACE_FAILED')
}

export async function touchTaskHeartbeat(taskId: string | undefined | null) {
  if (!taskId) return false
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: { heartbeatAt: new Date() },
  })
  return result.count > 0
}

export async function tryUpdateTaskProgress(taskId: string | undefined | null, progress: number, payload?: Record<string, unknown> | null) {
  // Defensive: a job without a taskId has no Task row to update — soft no-op
  // so the shared worker progress helper can keep streaming events without
  // blowing up. (Pre-9.1 this covered the bespoke playground path; post-9.1
  // playground rides the Task spine and always has a taskId.)
  if (!taskId) return false
  // Progress is presentation data layered onto the durable task contract.
  // Preserve all existing top-level inputs as well as meta so a watchdog
  // requeue can reconstruct the original BullMQ job after a worker restart.
  if (!payload) {
    const result = await taskModel.updateMany({
      where: activeTaskWhere(taskId),
      data: { progress },
    })
    return result.count > 0
  }

  // Payload-bearing progress updates are read/merge/write. Protect that
  // sequence with an exact JSON CAS so a concurrent durable publication
  // marker cannot be erased by a stale progress snapshot.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = await taskModel.findUnique({
      where: { id: taskId },
      select: { status: true, payload: true },
    })
    if (!existing || !isActiveStatus(existing.status)) return false
    const existingPayload = toObject(existing.payload)
    const existingMeta = toObject(existingPayload.meta)
    const incomingMeta = toObject(payload.meta)
    const merged = {
      ...existingPayload,
      ...payload,
      meta: { ...existingMeta, ...incomingMeta },
    }
    const result = await taskModel.updateMany({
      where: {
        ...activeTaskWhere(taskId),
        payload: { equals: toNullableJson(existingPayload) as Prisma.InputJsonValue },
      },
      data: {
        progress,
        payload: toNullableJson(merged),
      },
    })
    if (result.count > 0) return true
  }
  throw Object.assign(new Error('TASK_PROGRESS_PAYLOAD_CAS_RETRY_EXHAUSTED'), {
    code: 'EXTERNAL_ERROR',
  })
}

export async function tryMarkTaskCompleted(
  taskId: string | undefined | null,
  resultPayload?: Record<string, unknown> | null,
  billing?: { billingInfo?: TaskBillingInfo | null; billedAt?: Date | null },
) {
  if (!taskId) return false
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: {
      status: TASK_STATUS.COMPLETED,
      progress: 100,
      result: toNullableJson(resultPayload ?? null),
      finishedAt: new Date(),
      heartbeatAt: null,
      ...(billing?.billingInfo !== undefined
        ? { billingInfo: toNullableJson(billing.billingInfo as unknown as Prisma.InputJsonValue) }
        : {}),
      ...(billing?.billedAt !== undefined ? { billedAt: billing.billedAt } : {}),
    },
  })
  return result.count > 0
}

export async function tryMarkTaskFailed(taskId: string | undefined | null, errorCode: string, errorMessage: string) {
  if (!taskId) return false
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: {
      status: TASK_STATUS.FAILED,
      errorCode: errorCode.slice(0, 80),
      errorMessage: errorMessage.slice(0, 2000),
      finishedAt: new Date(),
      heartbeatAt: null,
    },
  })
  return result.count > 0
}

export async function markTaskProcessing(taskId: string | undefined | null, externalId?: string | null) {
  return await tryMarkTaskProcessing(taskId, externalId)
}

export async function updateTaskProgress(taskId: string | undefined | null, progress: number, payload?: Record<string, unknown> | null) {
  return await tryUpdateTaskProgress(taskId, progress, payload)
}

export async function markTaskCompleted(taskId: string | undefined | null, result?: Record<string, unknown> | null) {
  return await tryMarkTaskCompleted(taskId, result)
}

export async function markTaskFailed(taskId: string | undefined | null, errorCode: string, errorMessage: string) {
  return await tryMarkTaskFailed(taskId, errorCode, errorMessage)
}

export async function cancelTask(taskId: string, reason = 'Task cancelled by user') {
  const snapshot = await taskModel.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      type: true,
      externalId: true,
    },
  })
  if (!snapshot) {
    return {
      task: null,
      cancelled: false,
      providerHandoffProtected: false,
    }
  }

  if (isActiveStatus(snapshot.status) && isProtectedVoiceLineProviderHandoff(snapshot)) {
    return {
      task: await taskModel.findUnique({ where: { id: taskId } }),
      cancelled: false,
      providerHandoffProtected: true,
    }
  }

  // Claim the terminal state before touching the ledger. Completion/failure
  // workers use the same active -> terminal CAS, so exactly one contender owns
  // billing finalization. Rolling the freeze back first allowed a worker to win
  // completion afterwards and settle a task whose reservation was already
  // released.
  let cancelled = false
  if (isActiveStatus(snapshot.status)) {
    if (isPaidVoiceProviderTaskType(snapshot.type)) {
      // The provider claim can win after the snapshot read. The cancellation
      // CAS must therefore prove that no handoff was durably recorded at the
      // exact active -> terminal transition; a route-level preflight alone is
      // vulnerable to TOCTOU and could refund an accepted provider request.
      const result = await taskModel.updateMany({
        where: {
          id: taskId,
          status: { in: [...ACTIVE_STATUSES] },
          OR: [
            { externalId: null },
            { externalId: '' },
          ],
        },
        data: {
          status: TASK_STATUS.FAILED,
          errorCode: 'TASK_CANCELLED',
          errorMessage: reason.slice(0, 2000),
          finishedAt: new Date(),
          heartbeatAt: null,
        },
      })
      cancelled = result.count > 0
    } else {
      cancelled = await tryMarkTaskFailed(taskId, 'TASK_CANCELLED', reason)
    }
  }

  if (cancelled) {
    // Cancellation remains the primary lifecycle result even when compensation
    // fails. rollbackTaskBillingForTask persists billingInfo.status='failed',
    // which the JobView projects independently as refund.status='failed'.
    await rollbackTaskBillingForTask({
      taskId,
    })
  }

  const task = await taskModel.findUnique({ where: { id: taskId } })
  const providerHandoffProtected = !cancelled
    && !!task
    && isActiveStatus(task.status)
    && isProtectedVoiceLineProviderHandoff(task)
  return {
    task,
    cancelled,
    providerHandoffProtected,
  }
}

export async function sweepStaleTasks(params: {
  processingThresholdMs: number
  limit?: number
}) {
  const limit = Math.max(1, params.limit || 200)
  const processingBefore = new Date(Date.now() - Math.max(1, params.processingThresholdMs))

  const staleProcessing = await taskModel.findMany({
    where: {
      status: TASK_STATUS.PROCESSING,
      OR: [
        { heartbeatAt: { lt: processingBefore } },
        {
          heartbeatAt: null,
          startedAt: { lt: processingBefore },
        },
        {
          heartbeatAt: null,
          startedAt: null,
          updatedAt: { lt: processingBefore },
        },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      type: true,
      targetType: true,
      targetId: true,
      externalId: true,
      billingInfo: true,
    },
  })

  if (staleProcessing.length === 0) return []

  const timedOut: Array<typeof staleProcessing[number] & {
    errorCode: string
    errorMessage: string
    compensationFailed: boolean
  }> = []
  for (const task of staleProcessing) {
    // Paid VoiceLine handoffs need queue/provider-aware recovery. A generic
    // heartbeat timeout cannot prove that FAL did not accept the request and
    // must never refund/clear the Task before that recovery runs.
    if (isProtectedVoiceLineProviderHandoff(task)) continue
    const timeoutClaim = await claimTaskFailureAndRollback({
      taskId: task.id,
      errorCode: 'WATCHDOG_TIMEOUT',
      errorMessage: 'Task heartbeat timeout',
      extraWhere: {
        AND: [
          {
            status: TASK_STATUS.PROCESSING,
            OR: [
              { heartbeatAt: { lt: processingBefore } },
              {
                heartbeatAt: null,
                startedAt: { lt: processingBefore },
              },
              {
                heartbeatAt: null,
                startedAt: null,
                updatedAt: { lt: processingBefore },
              },
            ],
          },
          ...(voiceLineNoProviderHandoffWhere(task)
            ? [voiceLineNoProviderHandoffWhere(task)!]
            : []),
        ],
      },
    })
    if (timeoutClaim.claimed) {
      timedOut.push({
        ...task,
        errorCode: 'WATCHDOG_TIMEOUT',
        errorMessage: 'Task heartbeat timeout',
        compensationFailed:
          timeoutClaim.rollback.attempted && !timeoutClaim.rollback.rolledBack,
      })
    }
  }

  return timedOut
}

export async function dismissFailedTasks(taskIds: string[], userId: string) {
  if (taskIds.length === 0) return 0
  const result = await taskModel.updateMany({
    where: {
      id: { in: taskIds },
      userId,
      status: TASK_STATUS.FAILED,
    },
    data: {
      status: TASK_STATUS.DISMISSED,
    },
  })
  return result.count
}
