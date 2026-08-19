import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { normalizeTaskError } from '@/lib/errors/normalize'
import { toJobView, type JobStatusFilter } from '@/lib/task/job-view'
import { queryTasks } from '@/lib/task/service'
import { TASK_STATUS, type TaskStatus } from '@/lib/task/types'

type TaskListScope = 'detail' | 'summary'

const TASK_STATUSES = new Set<string>(Object.values(TASK_STATUS))
const JOB_STATUSES = new Set<JobStatusFilter>(['active', 'completed', 'failed', 'cancelled'])
const SUMMARY_TASK_STATUSES: TaskStatus[] = [
  TASK_STATUS.QUEUED,
  TASK_STATUS.PROCESSING,
  TASK_STATUS.COMPLETED,
  TASK_STATUS.FAILED,
]

function readString(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function readScope(value: string | null): TaskListScope {
  if (!value) return 'detail'
  if (value === 'detail') return 'detail'
  if (value === 'summary') return 'summary'
  throw new ApiError('INVALID_PARAMS', { field: 'scope' })
}

function readTaskStatuses(values: string[]): TaskStatus[] | undefined {
  if (!values.length) return undefined
  const statuses = values.map((value) => value.trim()).filter(Boolean)
  if (!statuses.length) return undefined
  if (statuses.some((status) => !TASK_STATUSES.has(status))) {
    throw new ApiError('INVALID_PARAMS', { field: 'status' })
  }
  return Array.from(new Set(statuses)) as TaskStatus[]
}

function readJobStatuses(values: string[]): JobStatusFilter[] | undefined {
  if (!values.length) return undefined
  const statuses = values.map((value) => value.trim()).filter(Boolean)
  if (!statuses.length) return undefined
  if (statuses.some((status) => !JOB_STATUSES.has(status as JobStatusFilter))) {
    throw new ApiError('INVALID_PARAMS', { field: 'jobStatus' })
  }
  return Array.from(new Set(statuses)) as JobStatusFilter[]
}

function readTypes(values: string[]): string[] | undefined {
  const types = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
  return types.length ? types : undefined
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toSafeTaskListPayload(value: unknown) {
  const payload = toRecord(value)
  if (!payload) return null
  const panelIds = Array.isArray(payload.panelIds)
    ? payload.panelIds
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .slice(0, 500)
    : []
  return panelIds.length ? { panelIds } : null
}

function toSafeTaskListItem(task: Awaited<ReturnType<typeof queryTasks>>[number]) {
  return {
    id: task.id,
    userId: task.userId,
    projectId: task.projectId,
    episodeId: task.episodeId,
    type: task.type,
    targetType: task.targetType,
    targetId: task.targetId,
    status: task.status,
    progress: task.progress,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    payload: toSafeTaskListPayload(task.payload),
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    error: normalizeTaskError(task.errorCode, task.errorMessage),
    queuedAt: task.queuedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const searchParams = request.nextUrl.searchParams
  const scope = readScope(searchParams.get('scope'))
  const projectId = readString(searchParams.get('projectId'))
  const episodeId = readString(searchParams.get('episodeId'))
  const targetType = readString(searchParams.get('targetType'))
  const targetId = readString(searchParams.get('targetId'))
  const cursor = readString(searchParams.get('cursor'))
  const status = readTaskStatuses(searchParams.getAll('status'))
  const jobStatus = readJobStatuses(searchParams.getAll('jobStatus'))
  const type = readTypes(searchParams.getAll('type'))
  const limitRaw = Number.parseInt(searchParams.get('limit') || '50', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50

  // With a project scope, project read access intentionally exposes teammate
  // tasks. Without a project scope this must stay caller-private at the DB
  // query itself; post-query filtering breaks pagination and can leak counts.
  if (projectId) {
    const access = await requireProjectAccess(projectId, session.user.id, 'read')
    if (!access.allowed) {
      return NextResponse.json({ tasks: [], nextCursor: null })
    }
  }

  const tasks = await queryTasks({
    ...(!projectId ? { userId: session.user.id } : {}),
    projectId,
    episodeId,
    targetType,
    targetId,
    status: scope === 'summary' && !status && !jobStatus ? SUMMARY_TASK_STATUSES : status,
    jobStatus,
    type,
    cursor,
    limit: limit + 1,
  })
  const hasMore = tasks.length > limit
  const page = hasMore ? tasks.slice(0, limit) : tasks
  const nextCursor = hasMore ? page.at(-1)?.id || null : null

  return NextResponse.json({
    tasks: scope === 'summary' ? page.map(toJobView) : page.map(toSafeTaskListItem),
    nextCursor,
  })
})
