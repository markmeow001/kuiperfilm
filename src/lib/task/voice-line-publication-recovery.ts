// NOTE: 不要加 `import 'server-only'`。这个模块同时被 Next server 与
// BullMQ worker（tsx 进程）共用；server-only 只有 Next bundler 会特殊处理，
// worker 运行时 require 会直接 Cannot find module → 整个 worker crash-loop
// （2026-08-20 prod 事故：所有队列任务停摆）。
import type { Job } from 'bullmq'
import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { resolveTaskLocaleFromBody } from '@/lib/task/resolve-locale'
import {
  TASK_STATUS,
  TASK_TYPE,
  type TaskBillingInfo,
  type TaskJobData,
} from '@/lib/task/types'

export type VoiceLinePublicationRecoveryResult = {
  state: 'active' | 'published' | 'no_output' | 'deleted' | 'failed' | 'empty'
  taskId: string | null
  nextCursor: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Reconciles at most one terminal VoiceLine publication. This deliberately
 * avoids a batch-delete capability: each watchdog tick must re-read one exact
 * Task marker and prove the one named object is globally unreferenced.
 */
export async function reconcileNextTerminalVoiceLinePublication(params: {
  afterTaskId?: string
} = {}): Promise<VoiceLinePublicationRecoveryResult> {
  const afterTaskId = typeof params.afterTaskId === 'string' && params.afterTaskId.trim()
    ? params.afterTaskId.trim()
    : undefined
  const tasks = await prisma.task.findMany({
    where: {
      type: TASK_TYPE.VOICE_LINE,
      status: { in: [TASK_STATUS.FAILED, TASK_STATUS.DISMISSED] },
      ...(afterTaskId ? { id: { gt: afterTaskId } } : {}),
    },
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      type: true,
      targetType: true,
      targetId: true,
      payload: true,
      billingInfo: true,
    },
    orderBy: { id: 'asc' },
    take: 1,
  })
  const task = tasks[0]
  if (!task) return { state: 'empty', taskId: null, nextCursor: null }

  const logger = createScopedLogger({ module: 'task.voice-line-publication-recovery' })
  try {
    if (!task.episodeId || !isRecord(task.payload)) {
      throw new Error('VOICE_LINE_PUBLICATION_RECOVERY_INPUT_INVALID')
    }
    const locale = resolveTaskLocaleFromBody(task.payload)
    if (!locale) throw new Error('VOICE_LINE_PUBLICATION_RECOVERY_LOCALE_INVALID')
    const job = {
      id: task.id,
      data: {
        taskId: task.id,
        type: TASK_TYPE.VOICE_LINE,
        locale,
        projectId: task.projectId,
        episodeId: task.episodeId,
        targetType: task.targetType,
        targetId: task.targetId,
        payload: task.payload,
        billingInfo: task.billingInfo as TaskBillingInfo | null,
        userId: task.userId,
        trace: null,
      },
    } as Job<TaskJobData>
    const { reconcileVoiceLineTerminalState } = await import('@/lib/voice/voice-line-publication')
    const state = await reconcileVoiceLineTerminalState(job, {
      verifyDeletedObject: true,
    })
    return { state, taskId: task.id, nextCursor: task.id }
  } catch (error) {
    logger.error({
      action: 'voice_line.publication_recovery.failed',
      message: 'VoiceLine terminal publication recovery failed',
      taskId: task.id,
      projectId: task.projectId,
      userId: task.userId,
      retryable: true,
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { name: 'Error', message: String(error) },
    })
    return { state: 'failed', taskId: task.id, nextCursor: task.id }
  }
}
