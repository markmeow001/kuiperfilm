import { NextRequest, NextResponse } from 'next/server'
import type { Job } from 'bullmq'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, requireProjectAccess } from '@/lib/api-auth'
import { removeTaskJob } from '@/lib/task/queues'
import { listTaskLifecycleEvents, publishTaskEvent } from '@/lib/task/publisher'
import { cancelTask, getTaskById } from '@/lib/task/service'
import { TASK_EVENT_TYPE, TASK_TYPE, type TaskBillingInfo, type TaskJobData } from '@/lib/task/types'
import { normalizeTaskError } from '@/lib/errors/normalize'
import { createScopedLogger } from '@/lib/logging/core'

const logger = createScopedLogger({ module: 'api.tasks.task' })

function taskLocaleFromPayload(payload: unknown): TaskJobData['locale'] | null {
  const record = toObject(payload)
  const meta = toObject(record.meta)
  const raw = typeof meta.locale === 'string'
    ? meta.locale
    : typeof record.locale === 'string'
      ? record.locale
      : ''
  const locale = raw.trim().toLowerCase()
  if (locale === 'zh' || locale.startsWith('zh-')) return 'zh'
  if (locale === 'en' || locale.startsWith('en-')) return 'en'
  return null
}

async function reconcileCancelledVoiceLineTask(
  task: NonNullable<Awaited<ReturnType<typeof getTaskById>>>,
): Promise<void> {
  if (task.type !== TASK_TYPE.VOICE_LINE) return
  const locale = taskLocaleFromPayload(task.payload)
  if (!locale || !task.episodeId) {
    throw new Error('VOICE_LINE_CANCEL_RECONCILIATION_INPUT_INVALID')
  }
  const { reconcileVoiceLineTerminalState } = await import('@/lib/voice/voice-line-publication')
  const job = {
    id: task.id,
    data: {
      taskId: task.id,
      type: TASK_TYPE.VOICE_LINE,
      locale,
      userId: task.userId,
      projectId: task.projectId,
      episodeId: task.episodeId,
      targetType: task.targetType,
      targetId: task.targetId,
      payload: toObject(task.payload),
      billingInfo: task.billingInfo as TaskBillingInfo | null,
      trace: null,
    },
  } as Job<TaskJobData>
  await reconcileVoiceLineTerminalState(job)
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toSafeTaskDetail(task: NonNullable<Awaited<ReturnType<typeof getTaskById>>>) {
  return {
    id: task.id,
    userId: task.userId,
    projectId: task.projectId,
    episodeId: task.episodeId,
    type: task.type,
    targetType: task.targetType,
    targetId: task.targetId,
    status: task.status,
    progress: task.progress,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    result: task.result,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    error: normalizeTaskError(task.errorCode, task.errorMessage),
    queuedAt: task.queuedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

const SAFE_EVENT_PAYLOAD_FIELDS = [
  'lifecycleType',
  'stage',
  'stageLabel',
  'stepId',
  'stepTitle',
  'stepIndex',
  'stepTotal',
  'progress',
  'message',
  'cancelled',
] as const

function toSafeLifecycleEvent(value: unknown) {
  const event = toObject(value)
  const payload = toObject(event.payload)
  const safePayload: Record<string, unknown> = {}
  for (const field of SAFE_EVENT_PAYLOAD_FIELDS) {
    if (field in payload) safePayload[field] = payload[field]
  }
  return {
    id: event.id,
    type: event.type,
    taskId: event.taskId,
    projectId: event.projectId,
    ts: event.ts,
    taskType: event.taskType,
    targetType: event.targetType,
    targetId: event.targetId,
    episodeId: event.episodeId,
    payload: safePayload,
  }
}

// Synthetic project ids with no real DB row (playground/canvas/asset-hub/…).
// Tasks under these are caller-private: there is no project to grant cross-user
// access, so we must NOT fall through to requireProjectAccess (which happens to
// return NOT_FOUND today only because the row is absent — a fragile implicit
// guard the moment such a row ever gets created).
const VIRTUAL_PROJECT_IDS = new Set(['playground', 'asset-hub', 'global-asset-hub', 'system'])

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { taskId } = await context.params

  const task = await getTaskById(taskId)
  if (!task) {
    throw new ApiError('NOT_FOUND')
  }
  // Real-project reads always use the caller's CURRENT project role. The
  // original submitter must lose access when removed from the project; task
  // ownership is not a durable authorization grant. Virtual-project tasks
  // have no project ACL and therefore remain submitter-only.
  if (!task.projectId || VIRTUAL_PROJECT_IDS.has(task.projectId)) {
    if (task.userId !== session.user.id) {
      throw new ApiError('NOT_FOUND')
    }
  } else {
    const access = await requireProjectAccess(task.projectId, session.user.id, 'read')
    if (!access.allowed) {
      throw new ApiError('NOT_FOUND')
    }
  }

  const includeEvents = request.nextUrl.searchParams.get('includeEvents') === '1'
  const eventsLimitRaw = Number.parseInt(request.nextUrl.searchParams.get('eventsLimit') || '500', 10)
  const eventsLimit = Number.isFinite(eventsLimitRaw) ? Math.min(Math.max(eventsLimitRaw, 1), 5000) : 500
  const events = includeEvents
    ? (await listTaskLifecycleEvents(taskId, eventsLimit)).map(toSafeLifecycleEvent)
    : null

  return NextResponse.json({
    // Do not expose worker input, provider ids, idempotency keys or raw
    // billing metadata through this polling endpoint. Consumers only need
    // lifecycle state and the generated result.
    task: toSafeTaskDetail(task),
    ...(events ? { events } : {}),
  })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { taskId } = await context.params

  const task = await getTaskById(taskId)
  if (!task) {
    throw new ApiError('NOT_FOUND')
  }
  // Phase V (2026-05-28) — DELETE is cancel. Owner / admin / ws_owner /
  // editor collaborators can cancel; viewer cannot. action='write' on
  // the cascade enforces that.
  if (!task.projectId || VIRTUAL_PROJECT_IDS.has(task.projectId)) {
    if (task.userId !== session.user.id) {
      throw new ApiError('NOT_FOUND')
    }
  } else {
    // Real-project cancellation is always governed by the caller's CURRENT
    // project role. A submitter who was later downgraded to viewer or removed
    // must not retain cancellation authority through task.userId.
    const access = await requireProjectAccess(task.projectId, session.user.id, 'write')
    if (!access.allowed) {
      throw new ApiError('NOT_FOUND')
    }
  }

  const { task: updatedTask, cancelled, providerHandoffProtected } = await cancelTask(taskId)
  if (!updatedTask) {
    throw new ApiError('NOT_FOUND')
  }
  if (providerHandoffProtected) {
    throw new ApiError('CONFLICT', {
      code: 'VOICE_PROVIDER_CANCEL_RECONCILIATION_REQUIRED',
      message: 'Voice provider request is already in progress and cannot be safely cancelled',
    })
  }

  const cancelledVoiceTask = updatedTask.type === TASK_TYPE.VOICE_LINE
    && updatedTask.errorCode === 'TASK_CANCELLED'
    && (updatedTask.status === 'failed' || updatedTask.status === 'dismissed')
  let voiceTerminalReconciled = !cancelledVoiceTask
  if (cancelledVoiceTask) {
    try {
      await reconcileCancelledVoiceLineTask(updatedTask)
      voiceTerminalReconciled = true
    } catch (error) {
      // Keep a queued/delayed job when terminal reconciliation is unavailable:
      // its task-specific lifecycle hook can retry the exact durable marker.
      // A repeated authorized DELETE also retries this same reconciliation.
      logger.warn({
        action: 'task.cancel.voice_reconcile_failed',
        message: 'cancelled voice task output reconciliation failed',
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        userId: updatedTask.userId,
        details: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  if ((cancelled || cancelledVoiceTask) && voiceTerminalReconciled) {
    // Remove only after task-specific durable output reconciliation has
    // succeeded. Generic tasks retain the historical best-effort removal.
    await removeTaskJob(taskId).catch(() => false)
  }

  if (cancelled) {
    try {
      await publishTaskEvent({
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        userId: updatedTask.userId,
        type: TASK_EVENT_TYPE.FAILED,
        taskType: updatedTask.type,
        targetType: updatedTask.targetType,
        targetId: updatedTask.targetId,
        episodeId: updatedTask.episodeId || null,
        payload: {
          stage: 'cancelled',
          stageLabel: '任务已取消',
          cancelled: true,
          message: updatedTask.errorMessage || 'Task cancelled by user'},
        persist: false})
    } catch (error) {
      // Cancellation already owns the durable terminal state. A transient
      // notification failure must not make the client retry a successful
      // cancellation or misreport it as failed.
      logger.warn({
        action: 'task.cancel.publish_failed',
        message: 'cancelled task event publish failed',
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        userId: updatedTask.userId,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  return NextResponse.json({
    success: true,
    cancelled,
    task: toSafeTaskDetail(updatedTask),
  })
})
