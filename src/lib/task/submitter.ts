import { createScopedLogger } from '@/lib/logging/core'
import { addTaskJob } from './queues'
import { publishTaskEvent } from './publisher'
import {
  createTask,
  assertIdempotentTaskBatchPreflight,
  failActiveTaskAndRollback,
  getTaskById,
  markTaskEnqueueFailed,
  markTaskEnqueued,
  markTaskFailed,
  rollbackTaskBillingForTask,
  tryUpdateActiveTaskBillingInfo,
  updateTaskPayload,
} from './service'
import { TASK_EVENT_TYPE, type TaskBillingInfo, type TaskType } from './types'
import { buildDefaultTaskBillingInfo, isBillableTaskType, InsufficientBalanceError, prepareTaskBilling } from '@/lib/billing'
import { ApiError } from '@/lib/api-errors'
import { getTaskFlowMeta } from '@/lib/llm-observe/stage-pipeline'
import type { Locale } from '@/i18n/routing'
import { attachTaskToRun, createRun } from '@/lib/run-runtime/service'
import { isAiTaskType, workflowTypeFromTaskType } from '@/lib/run-runtime/workflow'
import { enforceRateLimit } from './rate-limit'
import { assertNoEpisodeConflict } from './episode-conflict-guard'
// Phase 2.5 Step 4-C — Skill constraint enforcement runs at submitTask
// BEFORE billing freezes credits. Cheap (1-2 indexed reads, only when
// project has anchored Skill with constraints). Throws SKILL_PRECONDITION_FAILED
// (412) on violation so front-end can deep-link to setup.
import { loadSkillConfigById } from '@/lib/skills/server'
import { enforceConstraints } from '@/lib/skills/constraints'
import { assertNoVoiceLineTaskOutputReferences } from '@/lib/media/recursive-write-policy'

export function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function resolveRunIdFromPayload(payload: unknown): string | null {
  const obj = toObject(payload)
  const runId = typeof obj.runId === 'string' ? obj.runId.trim() : ''
  if (runId) return runId
  const meta = toObject(obj.meta)
  const runIdFromMeta = typeof meta.runId === 'string' ? meta.runId.trim() : ''
  return runIdFromMeta || null
}

export function normalizeTaskPayload(type: TaskType, payload?: Record<string, unknown> | null) {
  const nextPayload = {
    ...(payload || {}),
  }
  const flowMeta = getTaskFlowMeta(type)
  const payloadMeta = toObject(nextPayload.meta)
  const flowId =
    typeof nextPayload.flowId === 'string' && nextPayload.flowId.trim()
      ? nextPayload.flowId.trim()
      : flowMeta.flowId
  const flowStageTitle =
    typeof nextPayload.flowStageTitle === 'string' && nextPayload.flowStageTitle.trim()
      ? nextPayload.flowStageTitle.trim()
      : flowMeta.flowStageTitle
  const flowStageIndex =
    typeof nextPayload.flowStageIndex === 'number' && Number.isFinite(nextPayload.flowStageIndex)
      ? Math.max(1, Math.floor(nextPayload.flowStageIndex))
      : flowMeta.flowStageIndex
  const flowStageTotal =
    typeof nextPayload.flowStageTotal === 'number' && Number.isFinite(nextPayload.flowStageTotal)
      ? Math.max(flowStageIndex, Math.floor(nextPayload.flowStageTotal))
      : Math.max(flowStageIndex, flowMeta.flowStageTotal)

  return {
    ...nextPayload,
    flowId,
    flowStageIndex,
    flowStageTotal,
    flowStageTitle,
    meta: {
      ...payloadMeta,
      flowId:
        typeof payloadMeta.flowId === 'string' && payloadMeta.flowId.trim()
          ? payloadMeta.flowId.trim()
          : flowId,
      flowStageIndex:
        typeof payloadMeta.flowStageIndex === 'number' && Number.isFinite(payloadMeta.flowStageIndex)
          ? Math.max(1, Math.floor(payloadMeta.flowStageIndex))
          : flowStageIndex,
      flowStageTotal:
        typeof payloadMeta.flowStageTotal === 'number' && Number.isFinite(payloadMeta.flowStageTotal)
          ? Math.max(1, Math.floor(payloadMeta.flowStageTotal))
          : flowStageTotal,
      flowStageTitle:
        typeof payloadMeta.flowStageTitle === 'string' && payloadMeta.flowStageTitle.trim()
          ? payloadMeta.flowStageTitle.trim()
          : flowStageTitle,
    },
  }
}

export async function preflightIdempotentTaskBatch(params: {
  requests: Array<{
    idempotencyTaskId: string
    dedupeKey: string
    payload: Record<string, unknown>
  }>
}): Promise<void> {
  await assertIdempotentTaskBatchPreflight(params.requests)
}

export async function submitTask(params: {
  idempotencyTaskId?: string
  userId: string
  locale: Locale
  projectId: string
  episodeId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  dedupeKey?: string | null
  dedupeMode?: 'active' | 'idempotent'
  priority?: number
  maxAttempts?: number
  billingInfo?: TaskBillingInfo | null
  requestId?: string | null
  // Phase 2.5 (2026-06-11) — when the project has an originSkillId
  // and the caller has already resolved the Skill, pass its id here
  // so the worker can re-load config for prompts/constraints. The
  // videoModel (or other model fields) MUST already be pinned in
  // `payload` by the caller before getting here, so billing freezes
  // on the resolved model. See loadSkillConfigForProject.
  skillId?: string | null
  // 2026-06-25 — controlled-bulk paths (e.g. "analyze all episodes" fans out
  // one analyze per episode) submit a BOUNDED, deduped set in one server action.
  // The per-user rate limit exists to stop UNcontrolled UI loops, not these — and
  // actual LLM load is still throttled by text-worker concurrency. Set true ONLY
  // from a server-side orchestrator over a known-finite list, never a raw client path.
  skipRateLimit?: boolean
}) {
  const logger = createScopedLogger({
    module: 'task.submitter',
    action: 'task.submit',
    requestId: params.requestId || undefined,
    projectId: params.projectId,
    userId: params.userId,
  })

  // Per-user rate limit on generate-class tasks. Throws RATE_LIMIT
  // before we touch the DB / billing / queue, so a runaway loop
  // can't accumulate failed Task rows or burn quota. Categorized
  // by task type — see src/lib/task/rate-limit.ts for limits.
  if (!params.skipRateLimit) {
    await enforceRateLimit({ userId: params.userId, taskType: params.type })
  }

  // 2026-05-16 (B / F-QA-2 root cause) — refuse to enqueue when an
  // incompatible task is already mutating this episode's storyboard
  // graph. See src/lib/task/episode-conflict-matrix.ts for the rule
  // set. Same-type races are still handled by dedupeKey's DB unique
  // constraint; this layer covers CROSS-type races (e.g. user
  // triggers script_to_storyboard_run while a clips_build is still
  // rewriting clips for the same episode), which used to cause FK
  // violations in persistVoiceLines when panel rows got cascade-
  // deleted out from under the in-flight transaction.
  if (params.episodeId) {
    await assertNoEpisodeConflict({
      episodeId: params.episodeId,
      type: params.type,
    })
  }

  // Phase 2.5 Step 4-C — Skill constraint gate. Submit-time so the
  // user gets fast feedback (no billing rollback, no queue churn).
  // Only fires when the caller passed skillId AND the loaded config
  // has a `constraints` block. Loader returns null if the row is
  // archived between create and submit — we treat that as "skill no
  // longer applies" and skip the check (matches the route's own
  // soft-fallback). Constraint failures throw SKILL_PRECONDITION_FAILED
  // (412) which `apiHandler` surfaces as a friendly toast.
  if (params.skillId) {
    const resolvedSkill = await loadSkillConfigById(params.skillId)
    if (resolvedSkill) {
      await enforceConstraints(params.projectId, resolvedSkill.config, {
        episodeId: params.episodeId ?? null,
      })
    }
  }

  const normalizedPayloadBase = normalizeTaskPayload(params.type, params.payload || null)
  const normalizedPayloadMeta = toObject(normalizedPayloadBase.meta)
  const normalizedPayload = {
    ...normalizedPayloadBase,
    meta: {
      ...normalizedPayloadMeta,
      locale: params.locale,
    },
  }
  await assertNoVoiceLineTaskOutputReferences(normalizedPayload)

  const computedBillingInfo = isBillableTaskType(params.type)
    ? buildDefaultTaskBillingInfo(params.type, normalizedPayload)
    : null
  const resolvedBillingInfo = computedBillingInfo || params.billingInfo || null

  const { task, deduped } = await createTask({
    ...(params.idempotencyTaskId ? { idempotencyTaskId: params.idempotencyTaskId } : {}),
    userId: params.userId,
    projectId: params.projectId,
    episodeId: params.episodeId || null,
    type: params.type,
    targetType: params.targetType,
    targetId: params.targetId,
    payload: normalizedPayload,
    dedupeKey: params.dedupeKey || null,
    dedupeMode: params.dedupeMode,
    priority: params.priority,
    maxAttempts: params.maxAttempts,
    billingInfo: resolvedBillingInfo || null,
  })
  let runId = resolveRunIdFromPayload(task.payload)
  if (!deduped && isAiTaskType(params.type)) {
    const run = await createRun({
      userId: params.userId,
      projectId: params.projectId,
      episodeId: params.episodeId || null,
      workflowType: workflowTypeFromTaskType(params.type),
      taskType: params.type,
      taskId: task.id,
      targetType: params.targetType,
      targetId: params.targetId,
      input: normalizedPayload,
    })
    runId = run.id
    const payloadWithRunId = {
      ...normalizedPayload,
      runId,
      meta: {
        ...toObject(normalizedPayload.meta),
        runId,
      },
    }
    await updateTaskPayload(task.id, payloadWithRunId)
    await attachTaskToRun(run.id, task.id)
  }

  let preparedBillingInfo = (task.billingInfo || resolvedBillingInfo || null) as TaskBillingInfo | null
  const billingOff = (process.env.BILLING_MODE || 'OFF').toUpperCase() === 'OFF'
  if (!billingOff && !deduped && isBillableTaskType(params.type) && (!computedBillingInfo || !computedBillingInfo.billable)) {
    await markTaskFailed(task.id, 'INVALID_PARAMS', `missing server-generated billingInfo for billable task type: ${params.type}`)
    throw new ApiError('INVALID_PARAMS', {
      message: `missing server-generated billingInfo for billable task type: ${params.type}`,
    })
  }

  if (!deduped && preparedBillingInfo) {
    try {
      preparedBillingInfo = (await prepareTaskBilling({
        id: task.id,
        userId: params.userId,
        projectId: params.projectId,
        billingInfo: preparedBillingInfo,
      })) as TaskBillingInfo | null
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        await markTaskFailed(task.id, 'INSUFFICIENT_BALANCE', error.message)
        throw new ApiError('INSUFFICIENT_BALANCE', {
          message: error.message,
          required: error.required,
          available: error.available,
        })
      }
      const message = error instanceof Error ? error.message : String(error)
      await failActiveTaskAndRollback({
        taskId: task.id,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: message,
        billingInfo: preparedBillingInfo,
        clearDedupeKey: true,
      })
      throw error
    }

    if (preparedBillingInfo) {
      let stored: boolean
      try {
        stored = await tryUpdateActiveTaskBillingInfo(task.id, preparedBillingInfo)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await failActiveTaskAndRollback({
          taskId: task.id,
          errorCode: 'INTERNAL_ERROR',
          errorMessage: message,
          billingInfo: preparedBillingInfo,
          clearDedupeKey: true,
        })
        throw error
      }

      if (!stored) {
        // Cancellation may win while prepareTaskBilling is creating a ledger
        // freeze. Because the terminal owner cannot see an unstored snapshot,
        // the submitter that created it must compensate before it exits. The
        // active-only write above prevents a late freeze from being attached
        // to a cancelled task, and this branch prevents that task from being
        // published or enqueued afterwards.
        const rollback = await rollbackTaskBillingForTask({
          taskId: task.id,
          billingInfo: preparedBillingInfo,
        })
        const compensationFailed = rollback.attempted && !rollback.rolledBack
        throw new ApiError(compensationFailed ? 'INTERNAL_ERROR' : 'CONFLICT', {
          code: 'TASK_TERMINATED_DURING_BILLING',
          message: compensationFailed
            ? 'Task terminated while billing reservation rollback failed'
            : 'Task terminated before billing preparation completed',
          taskId: task.id,
          compensationFailed,
        })
      }
    }
  }

  if (!deduped) {
    const payloadForEvent = runId
      ? {
          ...normalizedPayload,
          runId,
          meta: {
            ...toObject(normalizedPayload.meta),
            runId,
          },
        }
      : normalizedPayload
    await publishTaskEvent({
      taskId: task.id,
      projectId: params.projectId,
      userId: params.userId,
      type: TASK_EVENT_TYPE.CREATED,
      taskType: params.type,
      targetType: params.targetType,
      targetId: params.targetId,
      episodeId: params.episodeId || null,
      payload: {
        ...payloadForEvent,
        billing: preparedBillingInfo || null,
        trace: {
          requestId: params.requestId || null,
        },
      },
    })
  }
  logger.info({
    action: 'task.submit.created',
    message: 'task created',
    taskId: task.id,
    details: {
      type: params.type,
      targetType: params.targetType,
      targetId: params.targetId,
    },
  })

  if (!deduped) {
    try {
      await addTaskJob({
        taskId: task.id,
        type: params.type,
        locale: params.locale,
        projectId: params.projectId,
        episodeId: params.episodeId || null,
        targetType: params.targetType,
        targetId: params.targetId,
        payload: runId
          ? {
              ...normalizedPayload,
              runId,
              meta: {
                ...toObject(normalizedPayload.meta),
                runId,
              },
            }
          : normalizedPayload,
        billingInfo: preparedBillingInfo || null,
        userId: params.userId,
        skillId: params.skillId ?? null,
        trace: {
          requestId: params.requestId || null,
        },
      }, {
        priority: typeof task.priority === 'number' ? task.priority : 0,
        attempts:
          typeof task.maxAttempts === 'number' && Number.isFinite(task.maxAttempts)
            ? Math.max(1, Math.floor(task.maxAttempts))
            : 5,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        await markTaskEnqueueFailed(task.id, message || 'queue.add failed')
      } catch (markerError) {
        logger.warn({
          action: 'task.submit.enqueue_failure_marker_failed',
          message: 'queue add failed and enqueue error marker could not be persisted',
          taskId: task.id,
          retryable: true,
          details: {
            markerError: markerError instanceof Error ? markerError.message : String(markerError),
          },
        })
      }
      // A rejected queue.add acknowledgement is ambiguous: Redis may already
      // have committed the idempotent job and a worker may be processing it.
      // Keep the Task active and its reservation intact. The tri-state
      // watchdog will only fail/refund it after Redis is reachable and the job
      // is authoritatively absent.
      logger.warn({
        action: 'task.submit.enqueue_handoff_unknown',
        message: 'queue add outcome unknown; task left active for watchdog reconciliation',
        taskId: task.id,
        errorCode: 'EXTERNAL_ERROR',
        retryable: true,
        details: {
          queueAccepted: 'unknown',
        },
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
              : {
                message: String(error),
              },
      })
      // Report the durable Task as accepted. Returning a transport error here
      // would encourage callers without an idempotency key to create a second
      // Task even though the first BullMQ job may already exist.
      return {
        success: true,
        async: true,
        taskId: task.id,
        runId,
        status: task.status,
        deduped,
      }
    }

    // BullMQ already accepted the durable job. A transient DB failure while
    // recording enqueuedAt must never fail/refund a job that a fast worker may
    // already be processing or may even have completed.
    try {
      await markTaskEnqueued(task.id)
      logger.info({
        action: 'task.submit.enqueued',
        message: 'task enqueued',
        taskId: task.id,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      let currentStatus = 'unknown'
      try {
        currentStatus = (await getTaskById(task.id))?.status || 'unknown'
      } catch {
        // Best-effort diagnostic only. Queue acceptance is authoritative here.
      }
      try {
        await markTaskEnqueueFailed(task.id, message || 'enqueued marker update failed')
      } catch {
        // Best-effort diagnostic only; the canonical watchdog can reconcile
        // the idempotent BullMQ job using taskId as jobId.
      }
      logger.warn({
        action: 'task.submit.enqueue_marker_failed',
        message: 'queue accepted task but enqueuedAt marker could not be persisted',
        taskId: task.id,
        retryable: true,
        details: {
          queueAccepted: true,
          status: currentStatus,
          markerError: message,
        },
      })
    }
  }

  return {
    success: true,
    async: true,
    taskId: task.id,
    runId,
    status: task.status,
    deduped,
  }
}
