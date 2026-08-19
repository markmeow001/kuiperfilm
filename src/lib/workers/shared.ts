import { UnrecoverableError, type Job } from 'bullmq'
import { rateLimitAwareBackoff } from '@/lib/task/queues'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import type { LLMStreamChunk } from '@/lib/llm-observe/types'
import { TaskTerminatedError } from '@/lib/task/errors'
import {
  getPaidVoiceProviderHandoffSnapshot,
  rollbackTaskBillingForTask,
  touchTaskHeartbeat,
  tryMarkPaidVoiceTaskFailedBeforeProviderHandoff,
  tryMarkPaidVoiceProviderTerminalFailure,
  tryMarkTaskCompleted,
  tryMarkTaskFailed,
  tryMarkTaskProcessing,
  tryUpdateTaskProgress,
  updateTaskBillingInfo,
} from '@/lib/task/service'
import { publishTaskEvent, publishTaskStreamEvent } from '@/lib/task/publisher'
import { TASK_EVENT_TYPE, TASK_TYPE, type TaskBillingInfo, type TaskJobData } from '@/lib/task/types'
import { buildTaskProgressMessage, getTaskStageLabel } from '@/lib/task/progress-message'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { settleTaskBilling } from '@/lib/billing'
import { withTextUsageCollection, type TextUsageEntry } from '@/lib/billing/runtime-usage'
import { onProjectNameAvailable } from '@/lib/logging/file-writer'
import type { NormalizedError } from '@/lib/errors/types'
import {
  isPaidVoiceProviderTaskType,
  type PaidVoiceProviderHandoffClassification,
  type PaidVoiceProviderTerminalStatus,
} from '@/lib/task/voice-line-recovery-policy'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function pendingSettlementInfo(
  info: Extract<TaskBillingInfo, { billable: true }>,
  textUsage: TextUsageEntry[],
  error?: unknown,
): Extract<TaskBillingInfo, { billable: true }> {
  const previous = info.settlement
  const message = error instanceof Error ? error.message : error === undefined ? null : String(error)
  return {
    ...info,
    settlement: {
      state: 'pending',
      attempts: Math.max(0, previous?.attempts || 0) + (message ? 1 : 0),
      textUsage: [...textUsage],
      lastAttemptAt: new Date().toISOString(),
      ...(message ? { lastError: message.slice(0, 1000) } : {}),
    },
  }
}

function readStringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readPositiveIntField(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function extractFlowFields(jobData: TaskJobData): Record<string, unknown> {
  const payload = toObject(jobData.payload)
  const flowId = readStringField(payload, 'flowId')
  const flowStageTitle = readStringField(payload, 'flowStageTitle')
  const flowStageIndex = readPositiveIntField(payload, 'flowStageIndex')
  const flowStageTotal = readPositiveIntField(payload, 'flowStageTotal')
  const payloadMeta = toObject(payload.meta)
  const runId = readStringField(payload, 'runId') || readStringField(payloadMeta, 'runId')

  return {
    ...(flowId ? { flowId } : {}),
    ...(flowStageTitle ? { flowStageTitle } : {}),
    ...(flowStageIndex ? { flowStageIndex } : {}),
    ...(flowStageTotal ? { flowStageTotal } : {}),
    ...(runId ? { runId } : {}),
  }
}

function withFlowFields(jobData: TaskJobData, payload?: Record<string, unknown> | null): Record<string, unknown> {
  const base = { ...(payload || {}) }
  const flowFields = extractFlowFields(jobData)
  for (const [key, value] of Object.entries(flowFields)) {
    if (base[key] === undefined || base[key] === null || base[key] === '') {
      base[key] = value
    }
  }
  // Preserve meta.locale from jobData on every progress event so the reconcile
  // / instrumentation re-enqueue paths can still resolve the task locale even
  // after worker-side progress updates overwrite task.payload via
  // tryUpdateTaskProgress. Without this, any in-flight task interrupted by a
  // worker restart fails with a misleading TASK_LOCALE_REQUIRED that masks the
  // real failure cause.
  const baseMeta =
    base.meta && typeof base.meta === 'object' && !Array.isArray(base.meta)
      ? (base.meta as Record<string, unknown>)
      : {}
  base.meta = {
    ...baseMeta,
    locale: jobData.locale,
  }
  return base
}

function buildWorkerLogger(data: TaskJobData, queueName: string) {
  return createScopedLogger({
    module: `worker.${queueName}`,
    requestId: data.trace?.requestId || undefined,
    taskId: data.taskId,
    projectId: data.projectId,
    userId: data.userId,
  })
}

const RUN_STREAM_REPLAY_PERSIST_TYPES = new Set<string>([
  TASK_TYPE.STORY_TO_SCRIPT_RUN,
  TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
])

function shouldPersistRunStreamReplay(taskType: string): boolean {
  return RUN_STREAM_REPLAY_PERSIST_TYPES.has(taskType)
}

function resolveQueueAttempts(job: Job<TaskJobData>): number {
  const attempts = (job.opts?.attempts ?? 1)
  const value = typeof attempts === 'number' && Number.isFinite(attempts) ? Math.floor(attempts) : 1
  return Math.max(1, value)
}

function resolveAttemptsMade(job: Job<TaskJobData>): number {
  const attemptsMade = job.attemptsMade
  const value = typeof attemptsMade === 'number' && Number.isFinite(attemptsMade) ? Math.floor(attemptsMade) : 0
  return Math.max(0, value)
}

function resolveNextBackoffMs(
  job: Job<TaskJobData>,
  failedAttempt: number,
  err?: Error,
): number | null {
  const backoff = job.opts?.backoff
  if (typeof backoff === 'number' && Number.isFinite(backoff) && backoff > 0) {
    return Math.floor(backoff)
  }
  if (!backoff || typeof backoff !== 'object') return null

  const backoffRecord = backoff as { type?: unknown; delay?: unknown }
  const type = typeof backoffRecord.type === 'string' ? backoffRecord.type : 'fixed'

  // 'custom' is resolved by the worker's registered backoffStrategy
  // (rateLimitAwareBackoff). Mirror it here so the log shows the
  // value BullMQ will actually wait — without this the log printed
  // the static base delay (2s) and made RATE_LIMIT retries look
  // like they fired every 2s when they actually waited a minute+.
  if (type === 'custom') {
    return rateLimitAwareBackoff(failedAttempt, type, err)
  }

  const baseDelay = typeof backoffRecord.delay === 'number' && Number.isFinite(backoffRecord.delay)
    ? Math.max(0, Math.floor(backoffRecord.delay))
    : 0
  if (baseDelay <= 0) return null
  if (type === 'exponential') {
    const exponent = Math.max(0, failedAttempt - 1)
    return baseDelay * Math.pow(2, exponent)
  }
  return baseDelay
}

function shouldRetryInQueue(params: {
  job: Job<TaskJobData>
  normalizedError: NormalizedError
  rawError?: Error
}): {
  enabled: boolean
  failedAttempt: number
  maxAttempts: number
  nextBackoffMs: number | null
} {
  const maxAttempts = resolveQueueAttempts(params.job)
  const failedAttempt = resolveAttemptsMade(params.job) + 1
  const enabled = params.normalizedError.retryable && failedAttempt < maxAttempts
  return {
    enabled,
    failedAttempt,
    maxAttempts,
    nextBackoffMs: resolveNextBackoffMs(params.job, failedAttempt, params.rawError),
  }
}

function buildErrorCauseChain(input: unknown): Array<{ name: string; message: string }> {
  const chain: Array<{ name: string; message: string }> = []
  const seen = new Set<unknown>()
  let current: unknown = input

  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || seen.has(current)) break
    seen.add(current)
    if (!(current instanceof Error)) {
      chain.push({ name: typeof current, message: String(current) })
      break
    }
    chain.push({
      name: current.name || 'Error',
      message: current.message || '',
    })
    const next = (current as Error & { cause?: unknown }).cause
    if (!next) break
    current = next
  }

  return chain
}

type PaidVoiceProviderTerminalSignal = {
  terminalStatus: PaidVoiceProviderTerminalStatus
  errorMessage: string
}

function paidVoiceProviderTerminalSignal(input: unknown): PaidVoiceProviderTerminalSignal | null {
  const seen = new Set<unknown>()
  let current: unknown = input
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || seen.has(current) || !(current instanceof Error)) break
    seen.add(current)
    if (current.message === 'ATLAS_AUDIO_PROVIDER_REQUEST_FAILED') {
      return { terminalStatus: 'failed', errorMessage: current.message }
    }
    if (current.message === 'ATLAS_AUDIO_PROVIDER_REQUEST_TIMEOUT') {
      return { terminalStatus: 'timeout', errorMessage: current.message }
    }
    current = (current as Error & { cause?: unknown }).cause
  }
  return null
}

type PaidVoiceHandoffInspection =
  | {
    known: true
    status: string
    progress: number
    handoff: PaidVoiceProviderHandoffClassification
  }
  | { known: true; status: null; progress: null; handoff: null }
  | { known: false; status: null; progress: null; handoff: null }

async function inspectPaidVoiceHandoff(params: {
  data: TaskJobData
  logger: ReturnType<typeof buildWorkerLogger>
}): Promise<PaidVoiceHandoffInspection> {
  if (!isPaidVoiceProviderTaskType(params.data.type)) {
    return { known: true, status: null, progress: null, handoff: null }
  }
  try {
    const snapshot = await getPaidVoiceProviderHandoffSnapshot(
      params.data.taskId,
      params.data.type,
    )
    if (!snapshot) return { known: true, status: null, progress: null, handoff: null }
    return { known: true, ...snapshot }
  } catch (error) {
    // If the authoritative provider handoff cannot be read, generic failure
    // is unsafe: the provider may already have accepted and billed the POST.
    params.logger.error({
      action: 'worker.paid_voice.handoff_inspection_failed',
      message: 'paid voice provider handoff could not be inspected; lifecycle stays quarantined',
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    })
    return { known: false, status: null, progress: null, handoff: null }
  }
}

async function persistPaidVoiceQuarantineMarker(params: {
  data: TaskJobData
  logger: ReturnType<typeof buildWorkerLogger>
  inspection: PaidVoiceHandoffInspection
  reasonCode: string
  errorMessage: string
  failedAttempt: number
  maxAttempts: number
}): Promise<void> {
  const { inspection } = params
  if (
    !inspection.known
    || inspection.progress === null
    || inspection.handoff?.kind !== 'actual'
  ) return

  try {
    await tryUpdateTaskProgress(
      params.data.taskId,
      inspection.progress,
      withFlowFields(params.data, {
        paidVoiceLifecycle: {
          state: 'quarantined',
          reasonCode: params.reasonCode.slice(0, 120),
          errorMessage: params.errorMessage.slice(0, 1000),
          failedAttempt: params.failedAttempt,
          maxAttempts: params.maxAttempts,
          provider: inspection.handoff.provider,
          providerExternalId: inspection.handoff.externalId,
          recordedAt: new Date().toISOString(),
        },
      }),
    )
  } catch (error) {
    // The marker is diagnostic. A write failure must still fail closed and
    // keep the active Task/freeze/dedupe untouched.
    params.logger.error({
      action: 'worker.paid_voice.quarantine_marker_failed',
      message: 'paid voice quarantine marker could not be persisted',
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    })
  }
}

async function runTerminalReconcileOrThrow(params: {
  reconcile?: () => Promise<unknown>
  logger: ReturnType<typeof buildWorkerLogger>
  action: string
  message: string
}): Promise<void> {
  try {
    await params.reconcile?.()
  } catch (reconcileError) {
    params.logger.error({
      action: params.action,
      message: params.message,
      error: reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
      retryable: true,
    })
    throw (reconcileError instanceof Error
      ? reconcileError
      : new Error('TASK_TERMINAL_RECONCILIATION_FAILED'))
  }
}

async function resolveProjectNameForLogging(projectId: string): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    })
    if (project?.name) {
      onProjectNameAvailable(projectId, project.name)
    }
  } catch {
    // Swallow – log file routing failure should never crash the worker.
  }
}

type TaskCompletionClaimInput = {
  taskId: string
  result: Record<string, unknown> | null
  billing?: { billingInfo?: TaskBillingInfo | null; billedAt?: Date | null }
}

type TaskLifecycleOptions = {
  completionClaim?: (input: TaskCompletionClaimInput) => Promise<boolean>
  terminalReconcile?: () => Promise<unknown>
}

export async function withTaskLifecycle(
  job: Job<TaskJobData>,
  handler: (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>,
  options?: TaskLifecycleOptions,
) {
  const data = job.data
  const taskId = data.taskId
  const logger = buildWorkerLogger(data, job.queueName)
  const startedAt = Date.now()
  let billingInfo = (data.billingInfo || null) as TaskBillingInfo | null
  let terminalClaim: 'completed' | null = null

  // Register project name for per-project log file routing
  void resolveProjectNameForLogging(data.projectId)

  const heartbeatTimer = setInterval(() => {
    void touchTaskHeartbeat(taskId)
  }, 10_000)

  try {
    logger.info({
      action: 'worker.start',
      message: 'worker started',
      details: {
        queue: job.queueName,
        taskType: data.type,
        targetType: data.targetType,
        targetId: data.targetId,
        episodeId: data.episodeId || null,
      },
    })
    const markedProcessing = await tryMarkTaskProcessing(taskId)
    if (!markedProcessing) {
      // Most tasks have no post-terminal side effects and keep the historical
      // fast skip. A task-specific reconciler may be supplied for durable
      // outputs whose exact cleanup marker must outlive cancellation/crashes.
      await options?.terminalReconcile?.()
      logger.info({
        action: 'worker.skip.terminated',
        message: 'task is not active, skip worker execution',
      })
      return
    }
    const processingPayload = withFlowFields(data, {
      queue: job.queueName,
      stage: 'received',
      stageLabel: getTaskStageLabel('received'),
      displayMode: 'loading',
      trace: {
        requestId: data.trace?.requestId || null,
      },
    })
    await publishTaskEvent({
      taskId,
      projectId: data.projectId,
      userId: data.userId,
      type: TASK_EVENT_TYPE.PROCESSING,
      taskType: data.type,
      targetType: data.targetType,
      targetId: data.targetId,
      episodeId: data.episodeId || null,
      payload: {
        ...processingPayload,
        message: buildTaskProgressMessage({
          eventType: TASK_EVENT_TYPE.PROCESSING,
          taskType: data.type,
          payload: processingPayload,
        }),
      },
    })

    const { result, textUsage } = await withTextUsageCollection(async () => await handler(job))
    const pendingBillingInfo = billingInfo?.billable
      ? pendingSettlementInfo(billingInfo, textUsage)
      : null
    const completionLeaseAt = pendingBillingInfo ? new Date() : null
    // Win terminal ownership before touching billing. The result, recoverable
    // settlement state, and lease are persisted in the same active->completed
    // CAS so a crash can never leave an untracked frozen reservation.
    const completionBilling = pendingBillingInfo
      ? { billingInfo: pendingBillingInfo, billedAt: completionLeaseAt }
      : undefined
    const markedCompleted = options?.completionClaim
      ? await options.completionClaim({
        taskId,
        result: result || null,
        billing: completionBilling,
      })
      : await tryMarkTaskCompleted(taskId, result || null, completionBilling)
    if (!markedCompleted) {
      logger.info({
        action: 'worker.skip.completed',
        message: 'task already terminal, skip billing and completed event',
        durationMs: Date.now() - startedAt,
      })
      return
    }
    terminalClaim = 'completed'

    if (pendingBillingInfo) {
      billingInfo = pendingBillingInfo
      try {
        const settled = (await settleTaskBilling({
          id: taskId,
          projectId: data.projectId,
          episodeId: data.episodeId || null,
          userId: data.userId,
          billingInfo: pendingBillingInfo,
        }, {
          result: (result || undefined) as Record<string, unknown> | void,
          textUsage,
          preserveFreezeOnFailure: true,
        })) as TaskBillingInfo
        if (!settled?.billable || (settled.status !== 'settled' && settled.status !== 'skipped')) {
          throw new Error('TASK_BILLING_SETTLEMENT_NOT_TERMINAL')
        }
        billingInfo = settled?.billable
          ? {
              ...settled,
              settlement: {
                ...pendingBillingInfo.settlement!,
                state: 'settled',
                lastAttemptAt: new Date().toISOString(),
              },
            }
          : settled
        await updateTaskBillingInfo(taskId, billingInfo, { billedAt: new Date() })
      } catch (settlementError) {
        const recoverable = pendingSettlementInfo(pendingBillingInfo, textUsage, settlementError)
        billingInfo = recoverable
        try {
          await updateTaskBillingInfo(taskId, recoverable, { billedAt: null })
        } catch (persistError) {
          logger.error({
            action: 'worker.billing.settlement_state_persist_failed',
            message: 'completed task billing recovery state could not be updated',
            error: persistError instanceof Error ? persistError.message : String(persistError),
          })
        }
        logger.error({
          action: 'worker.billing.settlement_pending',
          message: 'task output completed; billing settlement deferred to watchdog',
          error: settlementError instanceof Error ? settlementError.message : String(settlementError),
          retryable: true,
        })
      }
    }
    logger.info({
      action: 'worker.completed',
      message: 'worker completed',
      durationMs: Date.now() - startedAt,
      details: result || null,
    })
    const completedPayload = withFlowFields(data, {
      ...(result || {}),
      displayMode: 'loading',
      trace: {
        requestId: data.trace?.requestId || null,
      },
    })
    try {
      await publishTaskEvent({
        taskId,
        projectId: data.projectId,
        userId: data.userId,
        type: TASK_EVENT_TYPE.COMPLETED,
        taskType: data.type,
        targetType: data.targetType,
        targetId: data.targetId,
        episodeId: data.episodeId || null,
        payload: {
          ...completedPayload,
          message: buildTaskProgressMessage({
            eventType: TASK_EVENT_TYPE.COMPLETED,
            taskType: data.type,
            payload: completedPayload,
          }),
        },
      })
    } catch (publishError) {
      // Task + ledger are already terminal. An SSE/persistence notification
      // failure must never reverse billing or re-run provider generation.
      logger.warn({
        action: 'worker.completed.publish_failed',
        message: 'completed task event publish failed',
        error: publishError instanceof Error ? publishError.message : String(publishError),
      })
    }
  } catch (error: unknown) {
    const providerTerminalSignal = paidVoiceProviderTerminalSignal(error)
    if (error instanceof TaskTerminatedError && !providerTerminalSignal) {
      const failedAttempt = resolveAttemptsMade(job) + 1
      const maxAttempts = resolveQueueAttempts(job)
      const inspection = await inspectPaidVoiceHandoff({ data, logger })
      await persistPaidVoiceQuarantineMarker({
        data,
        logger,
        inspection,
        reasonCode: error.message || 'PAID_VOICE_HANDOFF_QUARANTINED',
        errorMessage: error.message || 'Task terminated',
        failedAttempt,
        maxAttempts,
      })
      await runTerminalReconcileOrThrow({
        reconcile: options?.terminalReconcile,
        logger,
        action: 'worker.terminated.reconcile_failed',
        message: 'terminal task output reconciliation failed',
      })
      logger.info({
        action: 'worker.terminated',
        message: error.message,
        durationMs: Date.now() - startedAt,
      })
      throw new UnrecoverableError(`Task terminated: ${error.message}`)
    }

    const normalizedError = normalizeAnyError(error, { context: 'worker' })
    const rawError = error instanceof Error ? error : undefined
    const baseRetryDecision = shouldRetryInQueue({
      job,
      normalizedError,
      rawError,
    })
    // A provider-reported terminal negative is not a transport retry. Retrying
    // this exact BullMQ job would only poll the same already-terminal request;
    // fail/refund once and require a deliberate new logical task instead.
    const retryDecision = providerTerminalSignal && isPaidVoiceProviderTaskType(data.type)
      ? { ...baseRetryDecision, enabled: false }
      : baseRetryDecision
    const errorCauseChain = buildErrorCauseChain(error)
    const workerFailureLog = {
      action: 'worker.failed',
      message: normalizedError.message,
      errorCode: normalizedError.code,
      retryable: normalizedError.retryable,
      provider: normalizedError.provider || undefined,
      durationMs: Date.now() - startedAt,
      details: {
        queue: job.queueName,
        taskType: data.type,
        targetType: data.targetType,
        targetId: data.targetId,
      },
      error:
        error instanceof Error
          ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: normalizedError.code,
            retryable: normalizedError.retryable,
            causeChain: errorCauseChain,
          }
          : {
            message: String(error),
            code: normalizedError.code,
            retryable: normalizedError.retryable,
            causeChain: errorCauseChain,
          },
    }
    if (retryDecision.enabled) {
      logger.error({
        ...workerFailureLog,
        action: 'worker.failed.retryable',
        message: `retryable failure: ${normalizedError.message}`,
      })
    } else {
      logger.error(workerFailureLog)
    }

    if (terminalClaim === 'completed') {
      // The worker already won completion before billing finalization failed.
      // Compensation (when needed) was performed by that winner above; never
      // let the generic failure path claim/rollback the same task a second time.
      throw new UnrecoverableError(normalizedError.message || 'Task finalization failed')
    }

    if (retryDecision.enabled) {
      logger.error({
        action: 'worker.retry.scheduled',
        message: 'retryable worker error, queue retry scheduled',
        errorCode: normalizedError.code,
        retryable: normalizedError.retryable,
        durationMs: Date.now() - startedAt,
        details: {
          queue: job.queueName,
          taskType: data.type,
          targetType: data.targetType,
          targetId: data.targetId,
          failedAttempt: retryDecision.failedAttempt,
          maxAttempts: retryDecision.maxAttempts,
          nextBackoffMs: retryDecision.nextBackoffMs,
        },
      })

      const retryPayload = withFlowFields(data, {
        stage: 'retrying',
        stageLabel: 'progress.runtime.stage.retrying',
        displayMode: 'detail',
        error: normalizedError,
        retry: {
          failedAttempt: retryDecision.failedAttempt,
          maxAttempts: retryDecision.maxAttempts,
          nextBackoffMs: retryDecision.nextBackoffMs,
        },
        trace: {
          requestId: data.trace?.requestId || null,
        },
      })

      try {
        await publishTaskEvent({
          taskId,
          projectId: data.projectId,
          userId: data.userId,
          type: TASK_EVENT_TYPE.PROGRESS,
          taskType: data.type,
          targetType: data.targetType,
          targetId: data.targetId,
          episodeId: data.episodeId || null,
          payload: {
            ...retryPayload,
            message: `Retry scheduled (${retryDecision.failedAttempt}/${retryDecision.maxAttempts}): ${normalizedError.message}`,
          },
          persist: false,
        })
      } catch (publishError) {
        logger.warn({
          action: 'worker.retry.progress_publish_failed',
          message: 'failed to publish retry progress event',
          details: {
            queue: job.queueName,
            taskType: data.type,
            taskId,
          },
          error: publishError instanceof Error ? publishError.message : String(publishError),
        })
      }

      throw (error instanceof Error ? error : new Error(normalizedError.message || 'Task failed'))
    }

    const paidVoiceInspection = await inspectPaidVoiceHandoff({ data, logger })
    let markedFailed: boolean
    if (providerTerminalSignal && isPaidVoiceProviderTaskType(data.type)) {
      if (
        !paidVoiceInspection.known
        || paidVoiceInspection.handoff?.kind !== 'actual'
      ) {
        await runTerminalReconcileOrThrow({
          reconcile: options?.terminalReconcile,
          logger,
          action: 'worker.paid_voice.provider_terminal_reconcile_failed',
          message: 'provider terminal signal could not be paired with an exact durable handoff',
        })
        throw new UnrecoverableError(
          'PAID_VOICE_PROVIDER_TERMINAL_HANDOFF_RECONCILIATION_REQUIRED',
        )
      }
      markedFailed = await tryMarkPaidVoiceProviderTerminalFailure({
        taskId,
        expectedTaskType: data.type,
        externalId: paidVoiceInspection.handoff.externalId,
        terminalStatus: providerTerminalSignal.terminalStatus,
        errorMessage: providerTerminalSignal.errorMessage,
      })
    } else {
      const hasProtectedPaidHandoff = isPaidVoiceProviderTaskType(data.type)
        && (
          !paidVoiceInspection.known
          || paidVoiceInspection.handoff?.kind === 'actual'
          || paidVoiceInspection.handoff?.kind === 'claim'
          || paidVoiceInspection.handoff?.kind === 'malformed'
        )
      if (hasProtectedPaidHandoff) {
        await persistPaidVoiceQuarantineMarker({
          data,
          logger,
          inspection: paidVoiceInspection,
          reasonCode: 'PAID_VOICE_DOWNSTREAM_OUTCOME_UNRESOLVED',
          errorMessage: normalizedError.message,
          failedAttempt: retryDecision.failedAttempt,
          maxAttempts: retryDecision.maxAttempts,
        })
        await runTerminalReconcileOrThrow({
          reconcile: options?.terminalReconcile,
          logger,
          action: 'worker.paid_voice.final_attempt_reconcile_failed',
          message: 'paid voice final-attempt reconciliation failed',
        })
        throw new UnrecoverableError('PAID_VOICE_DOWNSTREAM_OUTCOME_UNRESOLVED')
      }
      if (isPaidVoiceProviderTaskType(data.type)) {
        markedFailed = await tryMarkPaidVoiceTaskFailedBeforeProviderHandoff({
          taskId,
          expectedTaskType: data.type,
          errorCode: normalizedError.code,
          errorMessage: normalizedError.message,
        })
        if (!markedFailed) {
          const authoritativeInspection = await inspectPaidVoiceHandoff({ data, logger })
          const providerClaimWon = !authoritativeInspection.known
            || authoritativeInspection.handoff?.kind === 'actual'
            || authoritativeInspection.handoff?.kind === 'claim'
            || authoritativeInspection.handoff?.kind === 'malformed'
          if (providerClaimWon) {
            await persistPaidVoiceQuarantineMarker({
              data,
              logger,
              inspection: authoritativeInspection,
              reasonCode: 'PAID_VOICE_PROVIDER_HANDOFF_RACE_QUARANTINED',
              errorMessage: normalizedError.message,
              failedAttempt: retryDecision.failedAttempt,
              maxAttempts: retryDecision.maxAttempts,
            })
            await runTerminalReconcileOrThrow({
              reconcile: options?.terminalReconcile,
              logger,
              action: 'worker.paid_voice.handoff_race_reconcile_failed',
              message: 'paid voice provider handoff race reconciliation failed',
            })
            throw new UnrecoverableError('PAID_VOICE_PROVIDER_HANDOFF_RACE_QUARANTINED')
          }
        }
      } else {
        markedFailed = await tryMarkTaskFailed(
          taskId,
          normalizedError.code,
          normalizedError.message,
        )
      }
    }
    if (!markedFailed) {
      await runTerminalReconcileOrThrow({
        reconcile: options?.terminalReconcile,
        logger,
        action: 'worker.skip.failed.reconcile_failed',
        message: 'terminal winner output reconciliation failed',
      })
      logger.info({
        action: 'worker.skip.failed',
        message: 'task already terminal, skip failed event',
        durationMs: Date.now() - startedAt,
      })
      throw new UnrecoverableError('task already terminal')
    }
    if (billingInfo?.billable) {
      const rollbackResult = await rollbackTaskBillingForTask({
        taskId,
        billingInfo,
      })
      if (rollbackResult.billingInfo) {
        billingInfo = rollbackResult.billingInfo
      }
      if (rollbackResult.attempted && !rollbackResult.rolledBack) {
        logger.error({
          action: 'worker.failed.rollback_failed',
          message: 'failed task billing rollback failed',
          errorCode: 'BILLING_COMPENSATION_FAILED',
        })
      }
    }
    const failedPayload = withFlowFields(data, {
      error: normalizedError,
      displayMode: 'loading',
      trace: {
        requestId: data.trace?.requestId || null,
      },
    }) as Record<string, unknown>
    if (process.env.NODE_ENV !== 'production' && error instanceof Error && typeof error.stack === 'string') {
      failedPayload.errorStack = error.stack.slice(0, 8000)
    }
    try {
      await publishTaskEvent({
        taskId,
        projectId: data.projectId,
        userId: data.userId,
        type: TASK_EVENT_TYPE.FAILED,
        taskType: data.type,
        targetType: data.targetType,
        targetId: data.targetId,
        episodeId: data.episodeId || null,
        payload: {
          ...failedPayload,
          message: normalizedError.message || buildTaskProgressMessage({
            eventType: TASK_EVENT_TYPE.FAILED,
            taskType: data.type,
            payload: failedPayload,
          }),
        },
      })
    } catch (publishError) {
      // Task + billing are already terminal. Notification transport must not
      // prevent a task-specific durable-output reconciler from running.
      logger.warn({
        action: 'worker.failed.publish_failed',
        message: 'failed task event publish failed',
        error: publishError instanceof Error ? publishError.message : String(publishError),
      })
    }

    try {
      await options?.terminalReconcile?.()
    } catch (reconcileError) {
      // The task/billing/event are already terminal. Keep the original task
      // failure authoritative while leaving the task-specific durable marker
      // observable for a later terminal retry/watchdog reconciliation.
      logger.error({
        action: 'worker.failed.terminal_reconcile_failed',
        message: 'failed task output reconciliation failed',
        error: reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
        retryable: true,
      })
    }

    // Re-throw as UnrecoverableError so BullMQ records the job as failed
    // (without this, BullMQ thinks the job succeeded and never logs failure)
    // UnrecoverableError prevents BullMQ auto-retry since we already handle task state in app layer
    throw new UnrecoverableError(normalizedError.message || 'Task failed')
  } finally {
    clearInterval(heartbeatTimer)
  }
}

export async function reportTaskProgress(job: Job<TaskJobData>, progress: number, payload?: Record<string, unknown>) {
  const value = Math.max(0, Math.min(99, Math.floor(progress)))
  const logger = buildWorkerLogger(job.data, job.queueName)
  const nextPayload: Record<string, unknown> = withFlowFields(job.data, payload)
  const stage = typeof nextPayload.stage === 'string' ? nextPayload.stage : null
  if (stage && typeof nextPayload.stageLabel !== 'string') {
    nextPayload.stageLabel = getTaskStageLabel(stage)
  }
  if (typeof nextPayload.displayMode !== 'string') {
    nextPayload.displayMode = 'loading'
  }
  if (typeof nextPayload.message !== 'string') {
    nextPayload.message = buildTaskProgressMessage({
      eventType: TASK_EVENT_TYPE.PROGRESS,
      taskType: job.data.type,
      progress: value,
      payload: nextPayload,
    })
  }

  logger.info({
    action: 'worker.progress',
    message: 'worker progress update',
    details: {
      progress: value,
      ...nextPayload,
    },
  })

  const updated = await tryUpdateTaskProgress(job.data.taskId, value, nextPayload)
  if (!updated) {
    return
  }
  await publishTaskEvent({
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
    type: TASK_EVENT_TYPE.PROGRESS,
    taskType: job.data.type,
    targetType: job.data.targetType,
    targetId: job.data.targetId,
    episodeId: job.data.episodeId || null,
    payload: {
      progress: value,
      ...nextPayload,
      trace: {
        requestId: job.data.trace?.requestId || null,
      },
    },
    persist: shouldPersistRunStreamReplay(job.data.type),
  })
}

export async function reportTaskStreamChunk(
  job: Job<TaskJobData>,
  chunk: LLMStreamChunk,
  payload?: Record<string, unknown>,
) {
  const mergedPayload: Record<string, unknown> = withFlowFields(job.data, {
    ...(payload || {}),
    displayMode: 'detail',
    stream: chunk,
    done: false,
    message: payload?.message || (chunk.kind === 'reasoning' ? 'progress.runtime.llm.reasoning' : 'progress.runtime.llm.output'),
  })

  await publishTaskStreamEvent({
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
    taskType: job.data.type,
    targetType: job.data.targetType,
    targetId: job.data.targetId,
    episodeId: job.data.episodeId || null,
    payload: {
      ...mergedPayload,
      trace: {
        requestId: job.data.trace?.requestId || null,
      },
    },
    persist: shouldPersistRunStreamReplay(job.data.type),
  })
}
