import { resolveTaskErrorMessage } from './error-message'

type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed'

type TaskSnapshot = {
  id: string
  status: TaskStatus
  progress?: number | null
  result?: Record<string, unknown> | null
  errorMessage?: string | null
}

type TaskSnapshotResponse = {
  success: boolean
  task?: TaskSnapshot | null
}

type WaitTaskOptions = {
  intervalMs?: number
  timeoutMs?: number
  onTaskUpdate?: (task: TaskSnapshot) => void
  signal?: AbortSignal
}

function abortError(): Error {
  const error = new Error('Task polling aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal)
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function isAsyncTaskResponse(data: unknown): data is { async: true; taskId: string } {
  if (!data || typeof data !== 'object') return false
  const payload = data as Record<string, unknown>
  return payload.async === true && typeof payload.taskId === 'string' && payload.taskId.length > 0
}

export async function waitForTaskResult(taskId: string, options: WaitTaskOptions = {}) {
  const intervalMs = options.intervalMs ?? 1500
  const timeoutMs = options.timeoutMs ?? 0
  const onTaskUpdate = options.onTaskUpdate
  const signal = options.signal
  const startedAt = Date.now()

  while (true) {
    throwIfAborted(signal)
    if (timeoutMs > 0 && Date.now() - startedAt > timeoutMs) {
      throw new Error(`Task timeout: ${taskId}`)
    }

    const response = await fetch(`/api/tasks/${taskId}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null)
      throw new Error(resolveTaskErrorMessage(errorPayload, `Task fetch failed: ${taskId}`))
    }

    const payload = (await response.json()) as TaskSnapshotResponse
    throwIfAborted(signal)
    const task = payload.task
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    onTaskUpdate?.(task)

    if (task.status === 'completed') {
      return task.result || { success: true }
    }
    if (task.status === 'failed') {
      throw new Error(resolveTaskErrorMessage(task, `Task ${task.status}`))
    }
    if (task.status !== 'queued' && task.status !== 'processing') {
      throw new Error(resolveTaskErrorMessage(task, `Task ${task.status}`))
    }

    await sleep(intervalMs, signal)
  }
}

export async function resolveTaskResponse<T = Record<string, unknown>>(response: Response, options?: WaitTaskOptions) {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(resolveTaskErrorMessage(data, 'Request failed'))
  }
  if (isAsyncTaskResponse(data)) {
    return await waitForTaskResult(data.taskId, options) as T
  }
  return (data || {}) as T
}
