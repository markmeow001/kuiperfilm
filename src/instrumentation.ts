// Next.js Instrumentation - 在应用启动时执行
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // 在 Edge Runtime 中直接返回，避免加载 Prisma（它使用了动态代码生成）
  if (process.env.NEXT_RUNTIME === 'edge') {
    return
  }

  // Phase 0 redesign (2026-06-04) — design-only dev escape hatch.
  // When SKIP_INSTRUMENTATION=1, skip the Prisma + BullMQ + Redis
  // startup work. Used for component-library work where local infra
  // (MySQL / Redis) isn't running and you don't need task queues —
  // e.g. previewing /dev/components or any pure-UI route. Production
  // deploy NEVER sets this; if it accidentally shipped to prod, queues
  // would silently stop reconciling, which is loud enough that you'd
  // notice in 15 minutes.
  if (process.env.SKIP_INSTRUMENTATION === '1') {
    console.log('[Instrumentation] SKIP_INSTRUMENTATION=1 — skipping DB/Redis startup work')
    return
  }

  // 只在 Node.js 服务端运行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prisma } = await import('@/lib/prisma')
    const { logInfo: _ulogInfo, logError: _ulogError } = await import('@/lib/logging/core')

    // Phase 1: 将已确认交接的 queued 任务重新加入 BullMQ 队列
    // 解决 Redis 重启后 DB 仍为 queued 但 BullMQ Job 丢失的孤儿任务问题
    try {
      const { addTaskJob } = await import('@/lib/task/queues')
      const { failActiveTaskAndRollback } = await import('@/lib/task/service')
      const { locales } = await import('@/i18n/routing')
      const { TASK_TYPE } = await import('@/lib/task/types')
      type TaskBillingInfo = import('@/lib/task/types').TaskBillingInfo
      type TaskJobData = import('@/lib/task/types').TaskJobData
      type TaskType = import('@/lib/task/types').TaskType
      type ReplayTask = {
        id: string
        userId: string
        projectId: string
        episodeId: string | null
        type: string
        targetType: string
        targetId: string
        payload: unknown
        billingInfo: unknown
        priority: number
        createdAt: Date
      }

      const TASK_TYPE_SET: ReadonlySet<string> = new Set(Object.values(TASK_TYPE))

      function toObject(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        return value as Record<string, unknown>
      }

      function toTaskType(value: unknown): TaskType | null {
        if (typeof value !== 'string') return null
        if (!TASK_TYPE_SET.has(value)) return null
        return value as TaskType
      }

      function toTaskPayload(value: unknown): Record<string, unknown> | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null
        return value as Record<string, unknown>
      }

      function toTaskBillingInfo(value: unknown): TaskBillingInfo | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null
        const billing = value as Record<string, unknown>
        if (billing.billable !== true && billing.billable !== false) return null
        return billing as TaskBillingInfo
      }

      async function markTaskEnqueued(taskId: string) {
        await prisma.task.update({
          where: { id: taskId },
          data: {
            enqueuedAt: new Date(),
            lastEnqueueError: null,
          },
        })
      }

      async function markTaskEnqueueFailed(taskId: string, error: string) {
        await prisma.task.update({
          where: { id: taskId },
          data: {
            enqueueAttempts: { increment: 1 },
            lastEnqueueError: error.slice(0, 500),
          },
        })
      }

      function resolveTaskLocaleFromPayload(payload: unknown): TaskJobData['locale'] | null {
        const payloadObj = toObject(payload)
        const payloadMeta = toObject(payloadObj.meta)
        const raw = typeof payloadMeta.locale === 'string'
          ? payloadMeta.locale
          : typeof payloadObj.locale === 'string'
            ? payloadObj.locale
            : ''
        if (!raw.trim()) return null
        const normalized = raw.trim().toLowerCase()
        for (const locale of locales) {
          if (normalized === locale || normalized.startsWith(`${locale}-`)) {
            return locale
          }
        }
        return null
      }

      const RE_ENQUEUE_BATCH_SIZE = 100
      const replayCutoff = new Date()
      let replayCursor: { createdAt: Date; id: string } | null = null
      let enqueued = 0
      let failed = 0
      let scanned = 0

      // Use a stable keyset cursor. Replayed tasks intentionally remain
      // queued, so repeatedly taking the oldest page would otherwise starve
      // every acknowledged task after the first 100 rows.
      while (true) {
        const queuedTasks: ReplayTask[] = await prisma.task.findMany({
          where: {
            status: 'queued',
            // Only replay tasks whose original submitter completed the durable
            // queue handoff marker. A process may crash after createTask (or
            // while preparing a billing freeze); replaying that unprepared row
            // could call a provider without a valid reservation. Ambiguous
            // queue acknowledgements intentionally keep enqueuedAt null and are
            // resolved by the tri-state watchdog instead.
            enqueuedAt: { not: null },
            createdAt: { lte: replayCutoff },
            ...(replayCursor
              ? {
                  OR: [
                    { createdAt: { gt: replayCursor.createdAt } },
                    {
                      createdAt: replayCursor.createdAt,
                      id: { gt: replayCursor.id },
                    },
                  ],
                }
              : {}),
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
            priority: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: RE_ENQUEUE_BATCH_SIZE,
        })
        if (queuedTasks.length === 0) break

        scanned += queuedTasks.length
        for (const task of queuedTasks) {
          try {
            const taskType = toTaskType(task.type)
            if (!taskType) {
              await failActiveTaskAndRollback({
                taskId: task.id,
                errorCode: 'INVALID_TASK_TYPE',
                errorMessage: `invalid task type: ${String(task.type)}`,
                clearDedupeKey: true,
              })
              failed++
              continue
            }

            const locale = resolveTaskLocaleFromPayload(task.payload)
            if (!locale) {
              await failActiveTaskAndRollback({
                taskId: task.id,
                errorCode: 'TASK_LOCALE_REQUIRED',
                errorMessage: 'task locale is missing',
                clearDedupeKey: true,
              })
              failed++
              continue
            }

            const jobData: TaskJobData = {
              taskId: task.id,
              type: taskType,
              locale,
              projectId: task.projectId,
              episodeId: task.episodeId || null,
              targetType: task.targetType,
              targetId: task.targetId,
              payload: toTaskPayload(task.payload),
              billingInfo: toTaskBillingInfo(task.billingInfo),
              userId: task.userId,
              trace: null,
            }
            await addTaskJob(jobData, {
              priority: typeof task.priority === 'number' ? task.priority : 0,
            })
            await markTaskEnqueued(task.id)
            enqueued++
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await markTaskEnqueueFailed(task.id, message || 're-enqueue failed')
            _ulogError(`[Instrumentation] Failed to re-enqueue task ${task.id}:`, message)
            failed++
          }
        }

        const lastTask = queuedTasks[queuedTasks.length - 1]
        replayCursor = { createdAt: lastTask.createdAt, id: lastTask.id }
        if (queuedTasks.length < RE_ENQUEUE_BATCH_SIZE) break
      }

      if (enqueued > 0) {
        _ulogInfo(`[Instrumentation] Re-enqueued ${enqueued}/${scanned} acknowledged queued tasks into BullMQ`)
      }
      if (failed > 0) {
        _ulogError(`[Instrumentation] Failed to re-enqueue ${failed}/${scanned} tasks`)
      }
    } catch (error) {
      _ulogError('[Instrumentation] Failed to re-enqueue orphaned tasks:', error)
    }

    // ─── Phase 2: 启动 Task Watchdog（DB ↔ BullMQ 持续对账）───
    try {
      const { startTaskWatchdog } = await import('@/lib/task/reconcile')
      startTaskWatchdog()
      _ulogInfo('[Instrumentation] Task watchdog started')
    } catch (error) {
      _ulogError('[Instrumentation] Failed to start task watchdog:', error)
    }
  }
}
