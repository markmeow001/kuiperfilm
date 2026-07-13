import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { storyboardExportRequestSchema } from '@/lib/canvas/storyboard-export-contract'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import type { Locale } from '@/i18n/routing'

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth(); if (isErrorResponse(auth)) return auth
  const taskId = new URL(request.url).searchParams.get('taskId') || ''
  const task = await prisma.task.findFirst({ where: { id: taskId, userId: auth.session.user.id, type: TASK_TYPE.CANVAS_STORYBOARD_EXPORT } })
  if (!task) throw new ApiError('NOT_FOUND', { code: 'STORYBOARD_EXPORT_NOT_FOUND' })
  const result = asRecord(task.result); const key = typeof result.resultKey === 'string' ? result.resultKey : null
  return NextResponse.json({ status: task.status, resultKey: key, resultUrl: key ? getSignedUrl(key, 3600) : null, error: task.errorMessage })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth(); if (isErrorResponse(auth)) return auth
  const parsed = storyboardExportRequestSchema.safeParse(await request.json())
  if (!parsed.success) throw new ApiError('INVALID_PARAMS', { code: 'STORYBOARD_EXPORT_INVALID', details: { issues: parsed.error.issues.slice(0, 5) } })
  const submitted = await submitTask({ userId: auth.session.user.id, locale: (request.headers.get('x-locale') || 'zh') as Locale, projectId: 'playground', type: TASK_TYPE.CANVAS_STORYBOARD_EXPORT, targetType: 'canvas-storyboard-group', targetId: crypto.randomUUID(), payload: parsed.data, billingInfo: { billable: false, source: 'task', status: 'skipped' }, maxAttempts: 3 })
  return NextResponse.json({ success: true, taskId: submitted.taskId, status: submitted.status })
})
