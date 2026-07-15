import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getProjectModelConfig } from '@/lib/config-service'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import type { Locale } from '@/i18n/routing'

const MAX_DESCRIPTION_CHARS = 800

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const body = (await request.json()) as { description?: unknown; locale?: unknown }
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const locale = (typeof body.locale === 'string' ? body.locale : 'zh') as Locale
  if (!description) throw new ApiError('INVALID_PARAMS', { code: 'DESCRIPTION_REQUIRED', message: '请输入排戏描述' })
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new ApiError('INVALID_PARAMS', { code: 'DESCRIPTION_TOO_LONG', message: `排戏描述过长（${description.length}/${MAX_DESCRIPTION_CHARS} 字符）` })
  }
  const models = await getProjectModelConfig('playground', userId)
  const model = models.analysisModel
  if (!model) throw new ApiError('FORBIDDEN', { code: 'ANALYSIS_MODEL_NOT_CONFIGURED', message: '请先在 /profile 配置文本分析模型' })
  const submitted = await submitTask({
    userId,
    locale,
    projectId: 'playground',
    type: TASK_TYPE.CANVAS_DIRECTOR_BLOCKING,
    targetType: 'canvas-director-blocking',
    targetId: crypto.randomUUID(),
    payload: { description, analysisModel: model, model, maxInputTokens: 4000, maxOutputTokens: 2500 },
  })
  _ulogInfo(`[canvas.director-blocking] submitted taskId=${submitted.taskId} userId=${userId} chars=${description.length}`)
  return NextResponse.json({ taskId: submitted.taskId })
})
