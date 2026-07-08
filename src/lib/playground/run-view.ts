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
  /** 视频结果尾帧(签名 URL)— 画布续镜链首尾帧接力用;非视频/未抽出为 null。 */
  tailFrameUrl: string | null
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

/** 尾帧 key → 签名 URL(worker 写 result.tailFrameKey;没有就 null)。 */
function signTailFrameUrl(result: unknown): string | null {
  const key = asRecord(result).tailFrameKey
  if (typeof key !== 'string' || key.length === 0) return null
  return key.startsWith('http') ? key : getSignedUrl(key, 3600)
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
  // worker 进度更新会整包覆写 payload 顶层(只有 meta.* 被合并保留),
  // 所以 prompt/modelKey 在任务开跑后就从顶层消失了 — 回退读 submit 时
  // 写进 meta 的 originPrompt/originModelKey(2026-07-08 修「描述词面板
  // 不显示」)。更早的旧任务两处都没有,退回空串。
  const meta = asRecord(payload.meta)
  const prompt =
    typeof payload.prompt === 'string' && payload.prompt
      ? payload.prompt
      : typeof meta.originPrompt === 'string'
        ? meta.originPrompt
        : ''
  const modelKey =
    typeof payload.modelKey === 'string' && payload.modelKey
      ? payload.modelKey
      : typeof meta.originModelKey === 'string'
        ? meta.originModelKey
        : ''
  return {
    id: task.id,
    prompt,
    outputType: task.type === TASK_TYPE.PLAYGROUND_VIDEO ? 'video' : 'image',
    modelKey,
    status: mapTaskStatusToPlayground(task.status),
    resultUrls: signResultUrls(task.result),
    tailFrameUrl: signTailFrameUrl(task.result),
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    completedAt: task.finishedAt,
  }
}
