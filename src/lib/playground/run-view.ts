/**
 * Phase 9.1 (2026-06-20) — Task → Playground run view.
 *
 * Playground now rides the Task spine (projectId='playground'). The client
 * still speaks the original PlaygroundRun shape, so this is the single place
 * that projects a Task row onto that shape: status mapping (Task lifecycle →
 * playground states the UI polls on), outputType from task.type, and signed
 * result URLs out of Task.result.
 */

import { getSignedUrl } from '@/lib/cos'
import { TASK_TYPE } from '@/lib/task/types'

export type PlaygroundViewStatus = 'pending' | 'running' | 'succeeded' | 'failed'

/** Map a Task lifecycle status onto the playground states the client polls. */
export function mapTaskStatusToPlayground(taskStatus: string): PlaygroundViewStatus {
  switch (taskStatus) {
    case 'queued':
      return 'pending'
    case 'processing':
      return 'running'
    case 'completed':
      return 'succeeded'
    case 'failed':
    case 'dismissed':
      return 'failed'
    default:
      return 'pending'
  }
}

export interface PlaygroundRunView {
  id: string
  prompt: string
  outputType: 'image' | 'video'
  modelKey: string
  status: PlaygroundViewStatus
  resultUrls: string[] | null
  errorMessage: string | null
  createdAt: Date
  completedAt: Date | null
}

interface TaskLike {
  id: string
  type: string
  status: string
  payload: unknown
  result: unknown
  errorMessage: string | null
  createdAt: Date
  finishedAt: Date | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** Sign COS keys for browser playback; pass through anything already a URL. */
function signResultUrls(result: unknown): string[] | null {
  const urls = asRecord(result).resultUrls
  if (!Array.isArray(urls)) return null
  const out = urls
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((u) => (u.startsWith('http') ? u : getSignedUrl(u, 3600)))
  return out.length > 0 ? out : null
}

export function taskToPlaygroundRunView(task: TaskLike): PlaygroundRunView {
  const payload = asRecord(task.payload)
  return {
    id: task.id,
    prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
    outputType: task.type === TASK_TYPE.PLAYGROUND_VIDEO ? 'video' : 'image',
    modelKey: typeof payload.modelKey === 'string' ? payload.modelKey : '',
    status: mapTaskStatusToPlayground(task.status),
    resultUrls: signResultUrls(task.result),
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    completedAt: task.finishedAt,
  }
}
