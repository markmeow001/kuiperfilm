/**
 * Canvas 无限画布 — Text node writing assistant (扩写/改写/润色/续写).
 *
 * POST { text, mode, locale?, requestKey? } → submits a CANVAS_TEXT task on the
 * text worker and returns { taskId } (plus requestKey/deduped for R2V assist
 * modes). The canvas polls GET /api/tasks/[taskId] and reads task.result.text
 * when completed.
 *
 * The route does NOT call the LLM directly (CLAUDE.md §3): it only resolves
 * the model + submitTask; the text worker handler runs the model. Mode is a
 * server-side whitelist (no free-form instructions from the client). Uses the
 * 'playground' virtual project id like the rest of the canvas.
 */
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'
import {
  getR2VCanvasTextPolicy,
  isCanvasTextMode,
  isR2VCanvasTextMode,
  R2V_CANVAS_TEXT_MAX_CHARS,
} from '@/lib/workers/handlers/canvas-text'
import type { Locale } from '@/i18n/routing'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

const CANVAS_PROJECT_ID = 'playground'
const MAX_TEXT_CHARS = 20000
const MAX_REQUEST_KEY_CHARS = 160

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function resolveR2VRequestKey(
  rawRequestKey: unknown,
  input: { mode: string; locale: Locale; text: string },
): string {
  if (rawRequestKey === undefined || rawRequestKey === null) {
    return `auto-${sha256(`${input.mode}\0${input.locale}\0${input.text}`)}`
  }
  if (typeof rawRequestKey !== 'string') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_REQUEST_KEY',
      message: 'requestKey 必须是文字',
    })
  }
  const requestKey = rawRequestKey.trim()
  if (!requestKey || requestKey.length > MAX_REQUEST_KEY_CHARS) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_REQUEST_KEY',
      message: `requestKey 长度必须为 1–${MAX_REQUEST_KEY_CHARS} 个字符`,
      details: { max: MAX_REQUEST_KEY_CHARS, got: requestKey.length },
    })
  }
  return requestKey
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const body = (await request.json()) as {
    text?: unknown
    mode?: unknown
    modelKey?: unknown
    locale?: unknown
    requestKey?: unknown
  }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const mode = body.mode
  const rawLocale = body.locale === undefined ? 'zh' : body.locale

  if (!text) {
    throw new ApiError('INVALID_PARAMS', { code: 'TEXT_REQUIRED', message: '请输入文字内容' })
  }
  if (!isCanvasTextMode(mode)) {
    throw new ApiError('INVALID_PARAMS', { code: 'INVALID_MODE', message: '写作模式无效' })
  }
  if (rawLocale !== 'zh' && rawLocale !== 'en') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_LOCALE',
      message: 'locale 仅支持 zh 或 en',
      details: { supported: ['zh', 'en'] },
    })
  }
  const locale: Locale = rawLocale
  const r2vPolicy = isR2VCanvasTextMode(mode)
    ? getR2VCanvasTextPolicy(mode, locale)
    : null
  const maxTextChars = r2vPolicy ? R2V_CANVAS_TEXT_MAX_CHARS : MAX_TEXT_CHARS
  if (text.length > maxTextChars) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TEXT_TOO_LONG',
      message: `文字过长（${text.length}/${maxTextChars} 字符），请精简后重试`,
      details: { max: maxTextChars, got: text.length },
    })
  }

  const requestKey = r2vPolicy
    ? resolveR2VRequestKey(body.requestKey, { mode, locale, text })
    : null
  const dedupeKey = requestKey
    ? `canvas-text-r2v:${sha256(`${userId}\0${mode}\0${locale}\0${text}\0${requestKey}`)}`
    : null

  if (dedupeKey) {
    const existingTask = await prisma.task.findFirst({
      where: { userId, dedupeKey },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (existingTask) {
      _ulogInfo(
        `[canvas.text] idempotent replay taskId=${existingTask.id} userId=${userId} mode=${mode}`,
      )
      return NextResponse.json({
        taskId: existingTask.id,
        requestKey,
        deduped: true,
      })
    }
  }

  // Resolve the LLM model. Caller may pin an explicit enabled model (画布底部
  // AI 输入条的模型选择)；否则走 project → own /profile → admin fallback。
  // 显式选择必须能在用户已启用的 llm 清单中解析——解析失败就显式 400，
  // 绝不静默换成别的模型（no-provider-guessing 铁则）。
  const requestedModelKey = typeof body.modelKey === 'string' ? body.modelKey.trim() : ''
  let model: string
  if (requestedModelKey) {
    try {
      const selection = await resolveModelSelection(userId, requestedModelKey, 'llm')
      model = selection.modelKey
    } catch (error) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MODEL_NOT_ENABLED',
        message: '指定的文本模型未启用，请在 /profile 启用后重试',
        details: { requestedModelKey },
        cause: error instanceof Error ? error.message : String(error),
      })
    }
  } else {
    const models = await getProjectModelConfig(CANVAS_PROJECT_ID, userId)
    const fallback = models.analysisModel
    if (!fallback) {
      throw new ApiError('FORBIDDEN', {
        code: 'ANALYSIS_MODEL_NOT_CONFIGURED',
        // message 顶层放置——ApiError 从 details.message 提取用户可读文案，
        // 嵌套进 details.details 会显示裸 'Forbidden'（2026-07-13 画布实测发现）
        message: '请先在 /profile 配置文本分析模型',
      })
    }
    model = fallback
  }

  const targetId = crypto.randomUUID()
  const maxInputTokens = r2vPolicy
    ? Math.min(2000, text.length * 2 + 800)
    : Math.min(8000, Math.ceil(text.length / 2) + 500)

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
      maxOutputTokens: r2vPolicy?.maxOutputTokens ?? 3000,
      ...(requestKey ? { requestKey } : {}),
    },
    ...(dedupeKey
      ? {
          dedupeKey,
          dedupeMode: 'idempotent' as const,
          maxAttempts: 1,
        }
      : {}),
  })

  _ulogInfo(
    `[canvas.text] submitted taskId=${submitted.taskId} userId=${userId} mode=${String(mode)} chars=${text.length}`,
  )

  return NextResponse.json({
    taskId: submitted.taskId,
    ...(requestKey ? { requestKey, deduped: submitted.deduped } : {}),
  })
})
