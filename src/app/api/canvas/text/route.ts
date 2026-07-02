/**
 * Canvas 无限画布 — Text node writing assistant (扩写/改写/润色/续写).
 *
 * POST { text, mode, locale? } → submits a CANVAS_TEXT task on the text worker
 * and returns { taskId }. The canvas polls GET /api/tasks/[taskId] and reads
 * task.result.text when completed.
 *
 * The route does NOT call the LLM directly (CLAUDE.md §3): it only resolves
 * the model + submitTask; the text worker handler runs the model. Mode is a
 * server-side whitelist (no free-form instructions from the client). Uses the
 * 'playground' virtual project id like the rest of the canvas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { getProjectModelConfig } from '@/lib/config-service'
import { isCanvasTextMode } from '@/lib/workers/handlers/canvas-text'
import type { Locale } from '@/i18n/routing'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

const CANVAS_PROJECT_ID = 'playground'
const MAX_TEXT_CHARS = 20000

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const body = (await request.json()) as { text?: unknown; mode?: unknown; locale?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const mode = body.mode
  const locale = (typeof body.locale === 'string' ? body.locale : 'zh') as Locale

  if (!text) {
    throw new ApiError('INVALID_PARAMS', { code: 'TEXT_REQUIRED', message: '请输入文字内容' })
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TEXT_TOO_LONG',
      message: `文字过长（${text.length}/${MAX_TEXT_CHARS} 字符），请精简后重试`,
      details: { max: MAX_TEXT_CHARS, got: text.length },
    })
  }
  if (!isCanvasTextMode(mode)) {
    throw new ApiError('INVALID_PARAMS', { code: 'INVALID_MODE', message: '写作模式无效' })
  }

  // Resolve the user's analysis (LLM) model — project → own /profile → admin
  // fallback. Pinned into payload so billing freezes on it and the worker uses it.
  const models = await getProjectModelConfig(CANVAS_PROJECT_ID, userId)
  const model = models.analysisModel
  if (!model) {
    throw new ApiError('FORBIDDEN', {
      code: 'ANALYSIS_MODEL_NOT_CONFIGURED',
      details: { message: '请先在 /profile 配置文本分析模型' },
    })
  }

  const targetId = crypto.randomUUID()
  const maxInputTokens = Math.min(8000, Math.ceil(text.length / 2) + 500)

  const submitted = await submitTask({
    userId,
    locale,
    projectId: CANVAS_PROJECT_ID,
    type: TASK_TYPE.CANVAS_TEXT,
    targetType: 'canvas-text',
    targetId,
    payload: {
      text,
      mode,
      // buildTextTaskInfo checks analysisModel first, then model — set both so
      // billing identifies the model regardless of field-order refactors.
      analysisModel: model,
      model,
      maxInputTokens,
      maxOutputTokens: 3000,
    },
  })

  _ulogInfo(
    `[canvas.text] submitted taskId=${submitted.taskId} userId=${userId} mode=${String(mode)} chars=${text.length}`,
  )

  return NextResponse.json({ taskId: submitted.taskId })
})
