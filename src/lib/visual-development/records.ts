import type { Prisma } from '@prisma/client'
import { getSignedUrl } from '@/lib/cos'

type TaskSnapshot = {
  id: string
  status: string
  progress: number
  result: Prisma.JsonValue | null
  errorCode: string | null
  errorMessage: string | null
}

export function readResultKey(result: Prisma.JsonValue | null): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const record = result as Record<string, unknown>
  const urls = record.resultUrls
  if (!Array.isArray(urls)) return null
  const first = urls.find((value): value is string => typeof value === 'string' && value.length > 0)
  return first ?? null
}

export function projectCandidateTask(candidate: {
  taskId: string | null
  status: string
}, tasksById: ReadonlyMap<string, TaskSnapshot>) {
  const task = candidate.taskId ? tasksById.get(candidate.taskId) : null
  const resultKey = task ? readResultKey(task.result) : null
  return {
    taskStatus: task?.status ?? candidate.status,
    progress: task?.progress ?? 0,
    resultUrl: resultKey ? getSignedUrl(resultKey, 3600) : null,
    errorCode: task?.errorCode ?? null,
    errorMessage: task?.errorMessage ?? null,
  }
}
