import type { TaskIntent } from '@/lib/task/intent'
import { createScopedLogger } from '@/lib/logging/core'

export type TaskTargetStateQuery = {
  targetType: string
  targetId: string
  types?: string[]
}

export type TaskTargetState = {
  targetType: string
  targetId: string
  phase: 'idle' | 'queued' | 'processing' | 'completed' | 'failed'
  runningTaskId: string | null
  runningTaskType: string | null
  intent: TaskIntent
  hasOutputAtStart: boolean | null
  progress: number | null
  stage: string | null
  stageLabel: string | null
  lastError: {
    code: string
    message: string
  } | null
  updatedAt: string | null
}

export type TaskTargetStateBatchSubscriber = {
  targets: TaskTargetStateQuery[]
  resolve: (states: TaskTargetState[]) => void
  reject: (error: unknown) => void
}

export type TaskTargetStateBatch = {
  targetsByKey: Map<string, TaskTargetStateQuery>
  subscribers: TaskTargetStateBatchSubscriber[]
  timer: ReturnType<typeof setTimeout> | null
}

export const TARGET_STATE_BATCH_WINDOW_MS = 120
export const TARGET_STATE_CHUNK_SIZE = 500
export const pendingTaskTargetStateBatches = new Map<string, TaskTargetStateBatch>()
export const mergeTraceSignatureByKey = new Map<string, string>()
export const taskTargetStateLogger = createScopedLogger({
  module: 'query.use-task-target-state-map',
})
