import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { canvasComposeRequestSchema } from '@/lib/canvas/compose-contract'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import type { Locale } from '@/i18n/routing'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { resolveCanvasAssetScope } from '@/lib/canvas/canvas-assets'

function resultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const taskId = new URL(request.url).searchParams.get('taskId') || ''
  const task = await prisma.task.findFirst({ where: { id: taskId, userId: authResult.session.user.id, type: TASK_TYPE.CANVAS_COMPOSE_VIDEO } })
  if (!task) throw new ApiError('NOT_FOUND', { code: 'COMPOSITION_NOT_FOUND' })
  const result = resultRecord(task.result)
  const key = typeof result.resultKey === 'string' ? result.resultKey : null
  return NextResponse.json({ status: task.status, resultKey: key, resultUrl: key ? getSignedUrl(key, 3600) : null, durationSec: typeof result.durationSec === 'number' ? result.durationSec : null, error: task.errorMessage })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const parsed = canvasComposeRequestSchema.safeParse(await request.json())
  if (!parsed.success) throw new ApiError('INVALID_PARAMS', { code: 'COMPOSE_PAYLOAD_INVALID', details: { issues: parsed.error.issues.slice(0, 5) } })
  const scope = await resolveCanvasAssetScope(parsed.data.canvasId, authResult.session.user.id, {
    write: true,
    isAdmin: false,
  })
  const targetId = crypto.randomUUID()
  const submitted = await submitTask({
    userId: authResult.session.user.id,
    locale: ((request.headers.get('x-locale') || 'zh') as Locale),
    projectId: 'playground',
    type: TASK_TYPE.CANVAS_COMPOSE_VIDEO,
    targetType: 'canvas-composition',
    targetId,
    payload: {
      ...parsed.data,
      meta: {
        ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
      },
    },
    // Explicit free CPU task. No billing freeze is created.
    billingInfo: { billable: false, source: 'task', status: 'skipped' },
    maxAttempts: 3,
  })
  return NextResponse.json({ success: true, taskId: submitted.taskId, status: submitted.status })
})
