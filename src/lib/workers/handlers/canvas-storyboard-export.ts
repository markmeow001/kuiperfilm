import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { acquireCanvasHeavyRenderLock } from '@/lib/canvas/heavy-render-lock'
import { renderCanvasStoryboard } from '@/lib/canvas/remotion-storyboard-executor'
import { STORYBOARD_EXPORT_LIMITS } from '@/lib/canvas/storyboard-export-contract'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'

function firstResultKey(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const values = (result as { resultUrls?: unknown }).resultUrls
  return Array.isArray(values) && typeof values[0] === 'string' ? values[0] : null
}

export async function handleCanvasStoryboardExportTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.filter((value): value is string => typeof value === 'string') : []
  const titles = Array.isArray(payload.titles) ? payload.titles.filter((value): value is string => typeof value === 'string') : []
  if (taskIds.length < 1 || taskIds.length > STORYBOARD_EXPORT_LIMITS.maxItems || titles.length !== taskIds.length) throw new Error('STORYBOARD_EXPORT_INPUT_INVALID')
  const tasks = await prisma.task.findMany({ where: { id: { in: taskIds }, userId: job.data.userId } })
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const items = taskIds.map((id, index) => {
    const task = byId.get(id)
    const key = task?.status === 'completed' ? firstResultKey(task.result) : null
    if (!key || /^[a-z]+:\/\//i.test(key) || key.includes('..') || !key.startsWith('images/')) throw new Error(`STORYBOARD_SOURCE_NOT_READY:${id}`)
    return { title: titles[index], imageUrl: getSignedUrl(key, 3600) }
  })
  const release = await acquireCanvasHeavyRenderLock(`storyboard:${job.id}`)
  try {
    await reportTaskProgress(job, 10, { stage: 'storyboard_render_prepare' })
    const result = await renderCanvasStoryboard({ userId: job.data.userId, taskId: job.data.taskId, items, columns: payload.columns === 2 || payload.columns === 3 ? payload.columns : 4, showShotNumber: payload.showShotNumber !== false })
    await reportTaskProgress(job, 95, { stage: 'storyboard_render_done', peakRssBytes: result.peakRssBytes })
    return { success: true, resultKey: result.resultKey, resultUrls: [result.resultKey], peakRssBytes: result.peakRssBytes, outputBytes: result.outputBytes }
  } finally { await release() }
}
