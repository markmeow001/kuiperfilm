import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { rollbackTaskBilling } from '@/lib/billing'
import { locales } from '@/i18n/routing'
import { TASK_STATUS, type CreateTaskInput, type TaskBillingInfo, type TaskStatus } from './types'

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

function isPrismaKnownError(error: unknown): error is { code?: string } {
  return typeof error === 'object' && error !== null && 'code' in error
}

function isActiveStatus(status: string) {
  return status === TASK_STATUS.QUEUED || status === TASK_STATUS.PROCESSING
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
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

function resolveCompensationFailure(
  rollback: TaskBillingRollbackResult,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (!rollback.attempted || rollback.rolledBack) {
    return {
      errorCode: fallbackCode,
      errorMessage: fallbackMessage,
    }
  }
  return {
    errorCode: 'BILLING_COMPENSATION_FAILED',
    errorMessage: `${fallbackMessage}; billing rollback failed`,
  }
}

async function failTaskWithMissingLocale(task: {
  id: string
  billingInfo: unknown
}) {
  const rollbackResult = await rollbackTaskBillingForTask({
    taskId: task.id,
    billingInfo: task.billingInfo,
  })
  const failure = resolveCompensationFailure(
    rollbackResult,
    'TASK_LOCALE_REQUIRED',
    'task locale is missing',
  )

  await taskModel.update({
    where: { id: task.id },
    data: {
      status: TASK_STATUS.FAILED,
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
      finishedAt: new Date(),
      heartbeatAt: null,
      dedupeKey: null,
    },
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

export async function createTask(input: CreateTaskInput) {
  const model = taskModel

  if (input.dedupeKey) {
    const existing = await model.findFirst({
      where: {
        dedupeKey: input.dedupeKey,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      if (isActiveStatus(existing.status)) {
        if (!hasTaskLocale(existing.payload)) {
          await failTaskWithMissingLocale(existing)
        } else {
          // 校验 BullMQ Job 是否真的还活着，防止 DB 与队列状态脱节导致永久卡死
          const jobAlive = await verifyJobAlive(existing.id)
          if (jobAlive) {
            return { task: existing, deduped: true as const }
          }

          const rollbackResult = await rollbackTaskBillingForTask({
            taskId: existing.id,
            billingInfo: existing.billingInfo,
          })
          const failure = resolveCompensationFailure(
            rollbackResult,
            'RECONCILE_ORPHAN',
            'Queue job lost, replaced by new task',
          )

          // Job 已死（terminal / missing）→ 终止孤儿任务，释放 dedupeKey，继续创建新任务
          await model.update({
            where: { id: existing.id },
            data: {
              status: TASK_STATUS.FAILED,
              errorCode: failure.errorCode,
              errorMessage: failure.errorMessage,
              finishedAt: new Date(),
              heartbeatAt: null,
              dedupeKey: null,
            },
          })
        }
      } else {
        // dedupeKey is unique in DB. Release terminal-task key so a new task can be created.
        await model.update({
          where: { id: existing.id },
          data: { dedupeKey: null },
        })
      }
    }
  }

  const createData = {
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
      const collided = await model.findFirst({
        where: { dedupeKey: input.dedupeKey },
        orderBy: { createdAt: 'desc' },
      })

      if (collided) {
        if (isActiveStatus(collided.status)) {
          if (!hasTaskLocale(collided.payload)) {
            await failTaskWithMissingLocale(collided)
          } else {
            // P2002 竞态路径：同样校验 BullMQ Job 状态
            const jobAlive = await verifyJobAlive(collided.id)
            if (jobAlive) {
              return { task: collided, deduped: true as const }
            }

            const rollbackResult = await rollbackTaskBillingForTask({
              taskId: collided.id,
              billingInfo: collided.billingInfo,
            })
            const failure = resolveCompensationFailure(
              rollbackResult,
              'RECONCILE_ORPHAN',
              'Queue job lost, replaced by new task',
            )

            await model.update({
              where: { id: collided.id },
              data: {
                status: TASK_STATUS.FAILED,
                errorCode: failure.errorCode,
                errorMessage: failure.errorMessage,
                finishedAt: new Date(),
                heartbeatAt: null,
                dedupeKey: null,
              },
            })
          }
        } else {
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
  projectId?: string
  targetType?: string
  targetId?: string
  status?: TaskStatus[]
  type?: string[]
  limit?: number
}) {
  return await taskModel.findMany({
    where: {
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.targetId ? { targetId: filters.targetId } : {}),
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(filters.type?.length ? { type: { in: filters.type } } : {}),
    },
    orderBy: { createdAt: 'desc' },
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

export async function updateTaskBillingInfo(taskId: string, billingInfo: TaskBillingInfo | null) {
  return await taskModel.update({
    where: { id: taskId },
    data: {
      billingInfo: toNullableJson(billingInfo as unknown as Prisma.InputJsonValue),
    },
  })
}

/**
 * Read existing task.payload, deep-merge meta sub-object so callers that
 * only know "their slice" of meta don't blow away unrelated meta keys
 * (locale, route, userTier, runId, provider, etc.) written by upstream
 * layers. Other top-level fields are still replaced — callers that want
 * to extend a top-level field must spread it explicitly.
 *
 * Adds one DB read per call; only callers that pass non-null payload
 * pay it.
 */
async function mergePayloadMetaWithExisting(
  taskId: string | undefined | null,
  payload: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  if (!payload) return payload
  // Playground jobs have no backing Task row (state lives on PlaygroundRun).
  // Skip the meta-merge read entirely — there's nothing to merge with.
  // 2026-05-28: caused playground-video to crash on Prisma findUnique
  // with id: undefined.
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
    ...payload,
    meta: { ...existingMeta, ...incomingMeta },
  }
}

export async function updateTaskPayload(taskId: string | undefined | null, payload: Record<string, unknown> | null) {
  // Playground jobs have no Task row — nothing to update.
  if (!taskId) return null
  const merged = await mergePayloadMetaWithExisting(taskId, payload)
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
  // Jobs without a backing Task row (e.g. playground_video, which tracks
  // state on PlaygroundRun instead) have no taskId. The Task-cancellation
  // concept doesn't apply to them, so treat as active and let the job
  // proceed. Querying findUnique({ where: { id: undefined } }) would throw
  // "needs at least one of id or dedupeKey" and kill the job. (2026-05-28)
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
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: {
      status: TASK_STATUS.PROCESSING,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      externalId: externalId || null,
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

export async function touchTaskHeartbeat(taskId: string | undefined | null) {
  if (!taskId) return false
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: { heartbeatAt: new Date() },
  })
  return result.count > 0
}

export async function tryUpdateTaskProgress(taskId: string | undefined | null, progress: number, payload?: Record<string, unknown> | null) {
  // Playground jobs run via PlaygroundRun, not Task. They reach the
  // shared worker progress helper because the BullMQ job is the same
  // shape, but there's no Task row to update. Soft no-op so the worker
  // can keep streaming progress events without blowing up. (2026-05-28)
  if (!taskId) return false
  // payload meta keys (locale, route, userTier, runId, provider, etc.)
  // are owned across multiple layers — merge instead of replace so
  // worker progress events don't blow away upstream writes. See
  // mergePayloadMetaWithExisting for the canonical merge behaviour.
  const merged = payload ? await mergePayloadMetaWithExisting(taskId, payload) : payload
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: {
      progress,
      ...(merged ? { payload: toNullableJson(merged) } : {}),
    },
  })
  return result.count > 0
}

export async function tryMarkTaskCompleted(taskId: string | undefined | null, resultPayload?: Record<string, unknown> | null) {
  if (!taskId) return false
  const result = await taskModel.updateMany({
    where: activeTaskWhere(taskId),
    data: {
      status: TASK_STATUS.COMPLETED,
      progress: 100,
      result: toNullableJson(resultPayload ?? null),
      finishedAt: new Date(),
      heartbeatAt: null,
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
      billingInfo: true,
    },
  })
  if (!snapshot) {
    return {
      task: null,
      cancelled: false,
    }
  }

  const active = isActiveStatus(snapshot.status)
  const rollbackResult = active
    ? await rollbackTaskBillingForTask({
      taskId: taskId,
      billingInfo: snapshot.billingInfo,
    })
    : {
      attempted: false,
      rolledBack: true,
      billingInfo: parseTaskBillingInfo(snapshot.billingInfo),
    }

  const failure = resolveCompensationFailure(rollbackResult, 'TASK_CANCELLED', reason)
  const cancelled = await tryMarkTaskFailed(taskId, failure.errorCode, failure.errorMessage)
  const task = await taskModel.findUnique({ where: { id: taskId } })
  return {
    task,
    cancelled,
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
      billingInfo: true,
    },
  })

  if (staleProcessing.length === 0) return []

  const finishedAt = new Date()
  const timedOut: Array<typeof staleProcessing[number] & {
    errorCode: string
    errorMessage: string
  }> = []
  for (const task of staleProcessing) {
    const rollbackResult = await rollbackTaskBillingForTask({
      taskId: task.id,
      billingInfo: task.billingInfo,
    })
    const failure = resolveCompensationFailure(
      rollbackResult,
      'WATCHDOG_TIMEOUT',
      'Task heartbeat timeout',
    )

    const updated = await taskModel.updateMany({
      where: {
        id: task.id,
        status: TASK_STATUS.PROCESSING,
      },
      data: {
        status: TASK_STATUS.FAILED,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        finishedAt,
        heartbeatAt: null,
      },
    })
    if (updated.count > 0) {
      timedOut.push({
        ...task,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
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
