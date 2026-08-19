/**
 * Task Reconciliation — DB ↔ BullMQ 状态对账
 *
 * 解决 DB 任务状态与 BullMQ Job 状态脱节导致的任务永久卡死问题。
 * 提供三个层次的对账能力：
 *   1. isJobAlive   — 单任务即时检查（供 createTask 去重时调用）
 *   2. reconcileActiveTasks — 批量对账（供 watchdog 定时调用）
 *   3. startTaskWatchdog    — 定时巡检入口（在 instrumentation.ts 启动）
 */

import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import { settleTaskBilling } from '@/lib/billing'
import {
    TASK_STATUS,
    TASK_EVENT_TYPE,
    type TaskBillingInfo,
    type TaskJobData,
} from './types'
import { publishTaskEvent } from './publisher'
import { rollbackTaskBillingForTask } from './service'
import { recoverMissingVoiceLineJob } from './voice-line-job-recovery'
import {
    isPaidVoiceProviderTaskType,
    isProtectedVoiceLineProviderHandoff,
} from './voice-line-recovery-policy'
import {
    imageQueue,
    videoQueue,
    voiceQueue,
    textQueue,
} from './queues'

// ────────────────────── 常量 ──────────────────────

const ACTIVE_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]

/** watchdog 巡检间隔 */
const WATCHDOG_INTERVAL_MS = 60_000

/** processing 心跳超时阈值 */
const PROCESSING_TIMEOUT_MS = 5 * 60_000

/** 每次对账扫描上限 */
const RECONCILE_BATCH_SIZE = 200

/** terminal 态短暂竞态保护窗口，避免 worker 刚结束时被误判为孤儿任务 */
const TERMINAL_RECONCILE_GRACE_MS = 90_000

/** missing 态短暂竞态保护窗口，避免 createTask→enqueue 之间被误判为孤儿任务 */
const MISSING_RECONCILE_GRACE_MS = 30_000

const BILLING_RECONCILE_BATCH_SIZE = 50
const BILLING_SETTLEMENT_LEASE_MS = 5 * 60_000

// ────────────────────── BullMQ Job 状态检查 ──────────────────────

type JobProbe =
    | { state: 'alive' | 'missing' | 'unknown' }
    | {
        state: 'terminal'
        job: Job<TaskJobData>
        terminalState: 'completed' | 'failed'
    }

const ALL_QUEUES = [imageQueue, videoQueue, voiceQueue, textQueue]

/**
 * 检查 BullMQ 中某个 Job 的真实状态。
 * - alive:    Job 存在且仍可执行（waiting / active / delayed / waiting-children）
 * - terminal: Job 存在但已终态（completed / failed）
 * - missing:  Job 在所有队列中均不存在
 */
async function getJobState(taskId: string): Promise<JobProbe> {
    let probeFailed = false
    let terminal: Extract<JobProbe, { state: 'terminal' }> | null = null
    for (const queue of ALL_QUEUES) {
        try {
            const job = await queue.getJob(taskId)
            if (!job) continue
            const state = await job.getState()
            if (state === 'completed' || state === 'failed') {
                terminal ??= { state: 'terminal', job, terminalState: state }
                continue
            }
            // waiting | active | delayed | waiting-children → 仍然活着
            return { state: 'alive' }
        } catch {
            // Keep probing the remaining queues, but do not conclude that the
            // job is missing when Redis/BullMQ could not answer reliably.
            probeFailed = true
            continue
        }
    }
    // A terminal record is not sufficient when any other queue could not be
    // probed: a same-id live job there would make manual retry a duplicate.
    if (probeFailed) return { state: 'unknown' }
    if (terminal) return terminal
    return { state: 'missing' }
}

/**
 * 检查 BullMQ Job 是否仍然活着。
 * 供 createTask 去重时调用——如果 Job 已死，则不应复用旧的 active 任务。
 */
export async function isJobAlive(taskId: string): Promise<boolean> {
    const probe = await getJobState(taskId)
    if (probe.state === 'unknown') {
        throw new Error('Unable to determine BullMQ job state')
    }
    return probe.state === 'alive'
}

// ────────────────────── 孤儿任务终止 ──────────────────────

/**
 * 将一个孤儿任务标记为 failed 并发送 SSE 事件通知前端。
 */
async function failOrphanedTask(
    task: {
        id: string
        userId: string
        projectId: string
        episodeId: string | null
        type: string
        targetType: string
        targetId: string
    },
    reason: string,
): Promise<boolean> {
    // Claim the lifecycle terminal state first. A worker completing at the same
    // time uses the same active -> terminal CAS, so only the winner may touch
    // the billing reservation.
    const result = await prisma.task.updateMany({
        where: {
            id: task.id,
            status: { in: ACTIVE_STATUSES },
            ...(isPaidVoiceProviderTaskType(task.type)
                ? { OR: [{ externalId: null }, { externalId: '' }] }
                : {}),
        },
        data: {
            status: TASK_STATUS.FAILED,
            errorCode: 'RECONCILE_ORPHAN',
            errorMessage: reason,
            finishedAt: new Date(),
            heartbeatAt: null,
            dedupeKey: null,
        },
    })

    if (result.count > 0) {
        const rollbackResult = await rollbackTaskBillingForTask({ taskId: task.id })
        const compensationFailed = rollbackResult.attempted && !rollbackResult.rolledBack
        // 发送 FAILED 事件，触发前端 SSE 更新 + 数据刷新
        await publishTaskEvent({
            taskId: task.id,
            projectId: task.projectId,
            userId: task.userId,
            type: TASK_EVENT_TYPE.FAILED,
            taskType: task.type,
            targetType: task.targetType,
            targetId: task.targetId,
            episodeId: task.episodeId,
            payload: {
                stage: 'reconciled',
                stageLabel: '任务已自动恢复',
                message: reason,
                compensationFailed,
            },
            persist: false,
        })
    }

    return result.count > 0
}

// ────────────────────── 批量对账 ──────────────────────

/**
 * 对账所有 DB 中 active 的任务与 BullMQ 的真实状态。
 * 任何 DB 里 active 但 BullMQ 里 terminal / missing 的任务会被标记为 failed。
 */
export async function reconcileActiveTasks(): Promise<string[]> {
    const now = Date.now()
    const activeTasks = await prisma.task.findMany({
        where: {
            status: { in: ACTIVE_STATUSES },
        },
        select: {
            id: true,
            userId: true,
            projectId: true,
            episodeId: true,
            type: true,
            targetType: true,
            targetId: true,
            status: true,
            externalId: true,
            payload: true,
            billingInfo: true,
            priority: true,
            attempt: true,
            maxAttempts: true,
            heartbeatAt: true,
            updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: RECONCILE_BATCH_SIZE,
    })

    if (activeTasks.length === 0) return []

    const reconciled: string[] = []
    for (const task of activeTasks) {
        const jobProbe = await getJobState(task.id)
        const jobState = jobProbe.state
        if (jobState === 'alive') continue
        if (jobState === 'unknown') continue
        if (
            jobState === 'terminal'
            && isProtectedVoiceLineProviderHandoff(task)
        ) {
            // An actual provider id is resume-only and can safely reuse this
            // exact terminal BullMQ job. Submit claims, malformed ids, and
            // inconsistent payloads are quarantined by the shared recovery
            // validator without mutating/retrying the job.
            await recoverMissingVoiceLineJob(task, {
                job: jobProbe.job,
                terminalState: jobProbe.terminalState,
            })
            continue
        }
        if (
            jobState === 'terminal'
            && now - task.updatedAt.getTime() < TERMINAL_RECONCILE_GRACE_MS
        ) {
            continue
        }
        if (
            jobState === 'missing'
            && now - task.updatedAt.getTime() < MISSING_RECONCILE_GRACE_MS
        ) {
            continue
        }

        if (jobState === 'missing') {
            const recovery = await recoverMissingVoiceLineJob(task)
            if (recovery.protected) continue
        }

        const reason =
            jobState === 'terminal'
                ? 'Queue job already terminated but DB was not updated'
                : 'Queue job missing (likely lost during restart)'

        const failed = await failOrphanedTask(task, reason)
        if (failed) {
            reconciled.push(task.id)
        }
    }

    return reconciled
}

function parsePendingBillingInfo(raw: unknown): Extract<TaskBillingInfo, { billable: true }> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    if ((raw as { billable?: unknown }).billable !== true) return null
    const info = raw as Extract<TaskBillingInfo, { billable: true }>
    return info.settlement?.state === 'pending' ? info : null
}

function toResultRecord(raw: unknown): Record<string, unknown> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    return raw as Record<string, unknown>
}

export async function reconcilePendingBillingSettlements(): Promise<string[]> {
    const leaseExpiredBefore = new Date(Date.now() - BILLING_SETTLEMENT_LEASE_MS)
    const tasks = await prisma.task.findMany({
        where: {
            status: TASK_STATUS.COMPLETED,
            billingInfo: { path: '$.settlement.state', equals: 'pending' },
            OR: [{ billedAt: null }, { billedAt: { lt: leaseExpiredBefore } }],
        },
        select: {
            id: true,
            userId: true,
            projectId: true,
            episodeId: true,
            result: true,
            billingInfo: true,
            billedAt: true,
        },
        orderBy: { updatedAt: 'asc' },
        take: BILLING_RECONCILE_BATCH_SIZE,
    })
    const recovered: string[] = []
    const logger = createScopedLogger({ module: 'task.billing-reconcile' })
    for (const task of tasks) {
        const info = parsePendingBillingInfo(task.billingInfo)
        if (!info) continue
        const leaseAt = new Date()
        const claimed = await prisma.task.updateMany({
            where: {
                id: task.id,
                status: TASK_STATUS.COMPLETED,
                billedAt: task.billedAt,
                billingInfo: { path: '$.settlement.state', equals: 'pending' },
            },
            data: { billedAt: leaseAt },
        })
        if (claimed.count === 0) continue
        try {
            const settled = (await settleTaskBilling({
                id: task.id,
                projectId: task.projectId,
                episodeId: task.episodeId,
                userId: task.userId,
                billingInfo: info,
            }, {
                result: toResultRecord(task.result),
                textUsage: info.settlement?.textUsage || [],
                preserveFreezeOnFailure: true,
            })) as TaskBillingInfo
            if (!settled?.billable || (settled.status !== 'settled' && settled.status !== 'skipped')) {
                throw new Error('TASK_BILLING_SETTLEMENT_NOT_TERMINAL')
            }
            const settledInfo: TaskBillingInfo = {
                ...settled,
                settlement: {
                    ...info.settlement!,
                    state: 'settled' as const,
                    lastAttemptAt: new Date().toISOString(),
                },
            }
            const stored = await prisma.task.updateMany({
                where: { id: task.id, status: TASK_STATUS.COMPLETED, billedAt: leaseAt },
                data: { billingInfo: settledInfo as unknown as Prisma.InputJsonValue },
            })
            if (stored.count > 0) recovered.push(task.id)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const pendingInfo: TaskBillingInfo = {
                ...info,
                settlement: {
                    ...info.settlement!,
                    state: 'pending' as const,
                    attempts: (info.settlement?.attempts || 0) + 1,
                    lastAttemptAt: new Date().toISOString(),
                    lastError: message.slice(0, 1000),
                },
            }
            try {
                await prisma.task.updateMany({
                    where: { id: task.id, status: TASK_STATUS.COMPLETED, billedAt: leaseAt },
                    data: {
                        billingInfo: pendingInfo as unknown as Prisma.InputJsonValue,
                        billedAt: null,
                    },
                })
            } catch (persistError) {
                logger.error({
                    action: 'billing.recovery.persist_failed',
                    message: 'failed to release billing settlement lease',
                    taskId: task.id,
                    error: persistError instanceof Error ? persistError.message : String(persistError),
                })
            }
            logger.warn({
                action: 'billing.recovery.pending',
                message,
                taskId: task.id,
                retryable: true,
            })
        }
    }
    return recovered
}

// ────────────────────── Watchdog ──────────────────────

let watchdogTimer: ReturnType<typeof setInterval> | null = null
let voiceLinePublicationCursor: string | null = null
let watchdogCycleRunning = false

/**
 * 启动任务 watchdog 定时器。
 * 每个巡检周期执行：
 *   1. sweepStaleTasks — 心跳超时的 processing 任务 → failed
 *   2. reconcileActiveTasks — DB active 但 BullMQ 已死的任务 → failed
 */
export function startTaskWatchdog() {
    if (watchdogTimer) return

    const logger = createScopedLogger({ module: 'task.watchdog' })
    logger.info({
        action: 'watchdog.start',
        message: `Task watchdog started (interval: ${WATCHDOG_INTERVAL_MS}ms)`,
    })

    watchdogTimer = setInterval(async () => {
        if (watchdogCycleRunning) return
        watchdogCycleRunning = true
        try {
            // 1. 清理心跳超时的 processing 任务（已有逻辑，此前未被调用）
            const { sweepStaleTasks } = await import('./service')
            const sweptProcessing = await sweepStaleTasks({
                processingThresholdMs: PROCESSING_TIMEOUT_MS,
            })
            for (const task of sweptProcessing) {
                await publishTaskEvent({
                    taskId: task.id,
                    projectId: task.projectId,
                    userId: task.userId,
                    type: TASK_EVENT_TYPE.FAILED,
                    taskType: task.type,
                    targetType: task.targetType,
                    targetId: task.targetId,
                    episodeId: task.episodeId || null,
                    payload: {
                        stage: 'watchdog_timeout',
                        stageLabel: '任务超时已终止',
                        message: task.errorMessage,
                        errorCode: task.errorCode,
                        compensationFailed: task.compensationFailed,
                    },
                    persist: false,
                })
            }

            // 2. 对账 DB vs BullMQ
            const reconciled = await reconcileActiveTasks()

            // 3. Retry completed outputs whose billing settlement is pending.
            const recoveredBilling = await reconcilePendingBillingSettlements()

            // Reconcile at most one exact terminal VoiceLine marker per tick.
            // Reaching the end clears the cursor so failed cleanups are
            // revisited on a later pass without introducing another scheduler
            // or a batch-delete capability.
            const { reconcileNextTerminalVoiceLinePublication } = await import(
                './voice-line-publication-recovery'
            )
            const voicePublication = await reconcileNextTerminalVoiceLinePublication({
                ...(voiceLinePublicationCursor
                    ? { afterTaskId: voiceLinePublicationCursor }
                    : {}),
            })
            voiceLinePublicationCursor = voicePublication.nextCursor

            const total = sweptProcessing.length
                + reconciled.length
                + recoveredBilling.length
                + (voicePublication.state === 'empty' ? 0 : 1)
            if (total > 0) {
                logger.info({
                    action: 'watchdog.cycle',
                    message: `Watchdog: ${sweptProcessing.length} heartbeat-timeout, ${reconciled.length} orphan-reconciled, ${recoveredBilling.length} billing-settled, voice-publication=${voicePublication.state}`,
                })
            }
        } catch (error) {
            logger.error({
                action: 'watchdog.error',
                message: 'Watchdog cycle failed',
                error:
                    error instanceof Error
                        ? { name: error.name, message: error.message, stack: error.stack }
                    : { message: String(error) },
            })
        } finally {
            watchdogCycleRunning = false
        }
    }, WATCHDOG_INTERVAL_MS)
}
