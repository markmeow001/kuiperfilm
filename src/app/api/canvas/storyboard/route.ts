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

  const body = (await request.json()) as {
    script?: unknown
    mode?: unknown
    characters?: unknown
    brief?: unknown
    locale?: unknown
  }
  const locale = (typeof body.locale === 'string' ? body.locale : 'zh') as Locale
  const mode = body.mode === 'characters' ? 'characters' as const : 'script' as const

  let script = ''
  let characters: Array<{ name: string; description?: string }> = []
  let brief = ''
  if (mode === 'characters') {
    // 入口二「角色生成分镜脚本」：没有剧本，改由卡司 + 可选故事方向原创。
    if (!Array.isArray(body.characters) || body.characters.length === 0 || body.characters.length > 12) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CHARACTERS_REQUIRED',
        message: '请先连入并命名至少 1 个（最多 12 个）角色节点',
      })
    }
    characters = body.characters.map((item, i) => {
      const record = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : null
      const name = typeof record?.name === 'string' ? record.name.trim() : ''
      if (!name || name.length > 40) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CHARACTER_NAME_INVALID',
          message: `第 ${i + 1} 个角色需要 1–40 字的名称`,
        })
      }
      const description = typeof record?.description === 'string' ? record.description.trim().slice(0, 500) : ''
      return { name, ...(description ? { description } : {}) }
    })
    brief = typeof body.brief === 'string' ? body.brief.trim() : ''
    if (brief.length > 2000) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'BRIEF_TOO_LONG',
        message: `故事方向过长（${brief.length}/2000 字符）`,
      })
    }
  } else {
    script = typeof body.script === 'string' ? body.script.trim() : ''
    if (!script) {
      throw new ApiError('INVALID_PARAMS', { code: 'SCRIPT_REQUIRED', message: '请输入或连入剧本' })
    }
    if (script.length > MAX_SCRIPT_CHARS) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'SCRIPT_TOO_LONG',
        message: `剧本过长（${script.length}/${MAX_SCRIPT_CHARS} 字符），请分段处理`,
        details: { max: MAX_SCRIPT_CHARS, got: script.length },
      })
    }
  }

  // Resolve the user's analysis (LLM) model — project → own /profile → admin
  // fallback. Pinned into payload so billing freezes on it and the worker uses it.
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

  const targetId = crypto.randomUUID()
  // Rough token budget for billing quote (chars/2 in ≈ CJK ratio; capped output).
  const inputChars = mode === 'characters'
    ? JSON.stringify({ characters, brief }).length + 800
    : script.length
  const maxInputTokens = Math.min(8000, Math.ceil(inputChars / 2) + 500)

  const submitted = await submitTask({
    userId,
    locale,
    projectId: CANVAS_PROJECT_ID,
    type: TASK_TYPE.CANVAS_STORYBOARD,
    targetType: 'canvas-storyboard',
    targetId,
    payload: {
      mode,
      ...(mode === 'characters' ? { characters, brief } : { script }),
      // buildTextTaskInfo checks analysisModel first, then model — set both so
      // billing identifies the model regardless of field-order refactors.
      analysisModel: model,
      model,
      maxInputTokens,
      maxOutputTokens: 3000,
    },
  })

  _ulogInfo(
    `[canvas.storyboard] submitted taskId=${submitted.taskId} userId=${userId} model=${model} mode=${mode} scriptChars=${script.length} cast=${characters.length}`,
  )

  return NextResponse.json({
    success: true,
    taskId: submitted.taskId,
    runId: submitted.runId ?? null,
    status: submitted.status,
  })
})
