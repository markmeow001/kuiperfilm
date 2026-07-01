/**
 * Canvas 无限画布 — Script node: script → storyboard shots (LLM).
 *
 * POST { script, locale? } → submits a CANVAS_STORYBOARD task on the text
 * worker and returns { taskId }. The canvas polls GET /api/tasks/[taskId] and
 * reads task.result.shots when completed.
 *
 * The route does NOT call the LLM directly (CLAUDE.md §3): it only resolves the
 * model + submitTask; the text worker handler runs the model. Uses the
 * 'playground' virtual project id (already in billing VIRTUAL_PROJECT_IDS), so
 * it is project-independent like the rest of the canvas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { getProjectModelConfig } from '@/lib/config-service'
import type { Locale } from '@/i18n/routing'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

const CANVAS_PROJECT_ID = 'playground'
const MAX_SCRIPT_CHARS = 20000

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const body = (await request.json()) as { script?: unknown; locale?: unknown }
  const script = typeof body.script === 'string' ? body.script.trim() : ''
  const locale = (typeof body.locale === 'string' ? body.locale : 'zh') as Locale

  if (!script) {
    throw new ApiError('INVALID_PARAMS', { code: 'SCRIPT_REQUIRED' })
  }
  if (script.length > MAX_SCRIPT_CHARS) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SCRIPT_TOO_LONG',
      details: { max: MAX_SCRIPT_CHARS, got: script.length },
    })
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
  // Rough token budget for billing quote (chars/2 in ≈ CJK ratio; capped output).
  const maxInputTokens = Math.min(8000, Math.ceil(script.length / 2) + 500)

  const submitted = await submitTask({
    userId,
    locale,
    projectId: CANVAS_PROJECT_ID,
    type: TASK_TYPE.CANVAS_STORYBOARD,
    targetType: 'canvas-storyboard',
    targetId,
    payload: {
      script,
      model,
      maxInputTokens,
      maxOutputTokens: 3000,
    },
  })

  _ulogInfo(
    `[canvas.storyboard] submitted taskId=${submitted.taskId} userId=${userId} model=${model} scriptChars=${script.length}`,
  )

  return NextResponse.json({
    success: true,
    taskId: submitted.taskId,
    runId: submitted.runId ?? null,
    status: submitted.status,
  })
})
