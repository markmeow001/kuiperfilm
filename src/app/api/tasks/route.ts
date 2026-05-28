import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { queryTasks } from '@/lib/task/service'
import { type TaskStatus } from '@/lib/task/types'
import { normalizeTaskError } from '@/lib/errors/normalize'

function withTaskError(task: Awaited<ReturnType<typeof queryTasks>>[number]) {
  const error = normalizeTaskError(task.errorCode, task.errorMessage)
  return {
    ...task,
    error,
  }
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const searchParams = request.nextUrl.searchParams
  const projectId = searchParams.get('projectId') || undefined
  const targetType = searchParams.get('targetType') || undefined
  const targetId = searchParams.get('targetId') || undefined
  const status = searchParams.getAll('status')
  const type = searchParams.getAll('type')
  const limit = Number.parseInt(searchParams.get('limit') || '50', 10)

  // Phase V (2026-05-28) — task list auth split by scope:
  //
  //   With projectId query param → project-scoped list. Run the 8-tier
  //     cascade on that project; on allow, return ALL tasks for the
  //     project (no userId filter) so workspace members / admin / etc
  //     can see teammate-generated videos. Without this, multi-shot
  //     video tasks created by IkariNERV were invisible to admin
  //     holykinds even after the project /data fix.
  //
  //   Without projectId          → personal task list (e.g. global
  //     activity log). Keep the original userId filter — there's no
  //     project to cascade against, and exposing cross-user tasks
  //     without a scope key would leak unrelated work.
  if (projectId) {
    const access = await requireProjectAccess(projectId, session.user.id, 'read')
    if (!access.allowed) {
      return NextResponse.json({ tasks: [] })
    }
    const tasks = await queryTasks({
      projectId,
      targetType,
      targetId,
      status: status.length ? (status as TaskStatus[]) : undefined,
      type: type.length ? type : undefined,
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50,
    })
    return NextResponse.json({ tasks: tasks.map(withTaskError) })
  }

  const tasks = await queryTasks({
    projectId,
    targetType,
    targetId,
    status: status.length ? (status as TaskStatus[]) : undefined,
    type: type.length ? type : undefined,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50,
  })

  const filtered = tasks
    .filter((task) => task.userId === session.user.id)
    .map(withTaskError)
  return NextResponse.json({ tasks: filtered })
})
