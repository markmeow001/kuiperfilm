/**
 * Canvas 无限画布 — 导演台 AI 导演路线方案 (previz S4)。
 *
 * POST { description, cast?, props?, locale? } → submits a
 * CANVAS_DIRECTOR_ROUTES task on the text worker and returns { taskId }.
 * 画布 poll GET /api/tasks/[taskId]，completed 后读 task.result.plans
 * （DirectorRoutePlan[]，已在 handler 内白名单收敛），客户端
 * route-materialize 落成 previz 镜头序列。
 *
 * The route does NOT call the LLM directly (CLAUDE.md §3): it only resolves
 * the model + submitTask; the text worker handler runs the model. Uses the
 * 'playground' virtual project id like the rest of the canvas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { getProjectModelConfig } from '@/lib/config-service'
import type { Locale } from '@/i18n/routing'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

const CANVAS_PROJECT_ID = 'playground'
const MAX_DESCRIPTION_CHARS = 500
const MAX_LABELS = 12

function toLabelList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 40))
    .slice(0, MAX_LABELS)
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const body = (await request.json()) as { description?: unknown; cast?: unknown; props?: unknown; locale?: unknown }
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const locale = (typeof body.locale === 'string' ? body.locale : 'zh') as Locale

  if (!description) {
    throw new ApiError('INVALID_PARAMS', { code: 'DESCRIPTION_REQUIRED', message: '请输入场景描述' })
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DESCRIPTION_TOO_LONG',
      message: `场景描述过长（${description.length}/${MAX_DESCRIPTION_CHARS} 字符），请精简后重试`,
      details: { max: MAX_DESCRIPTION_CHARS, got: description.length },
    })
  }

  const models = await getProjectModelConfig(CANVAS_PROJECT_ID, userId)
  const model = models.analysisModel
  if (!model) {
    throw new ApiError('FORBIDDEN', {
      code: 'ANALYSIS_MODEL_NOT_CONFIGURED',
      // message 顶层放置——ApiError 从 details.message 提取用户可读文案，
      // 嵌套进 details.details 会显示裸 'Forbidden'（2026-07-13 画布实测发现）
      message: '请先在 /profile 配置文本分析模型',
    })
  }

  const submitted = await submitTask({
    userId,
    locale,
    projectId: CANVAS_PROJECT_ID,
    type: TASK_TYPE.CANVAS_DIRECTOR_ROUTES,
    targetType: 'canvas-director-routes',
    targetId: crypto.randomUUID(),
    payload: {
      description,
      cast: toLabelList(body.cast),
      props: toLabelList(body.props),
      // buildTextTaskInfo checks analysisModel first, then model — set both so
      // billing identifies the model regardless of field-order refactors.
      analysisModel: model,
      model,
      maxInputTokens: 4000,
      maxOutputTokens: 3000,
    },
  })

  _ulogInfo(
    `[canvas.director-routes] submitted taskId=${submitted.taskId} userId=${userId} chars=${description.length}`,
  )

  return NextResponse.json({ taskId: submitted.taskId })
})
