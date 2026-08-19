/**
 * Canvas 脚本生成器 step 3 — 合成提示词.
 *
 * POST { shots, assets?, globalStyle?, locale? } → submits a
 * CANVAS_SHOT_PROMPTS task on the text worker and returns { taskId }. The
 * canvas polls GET /api/tasks/[taskId] and reads task.result.prompts when
 * completed. The route does NOT call the LLM directly (CLAUDE.md §3): it only
 * validates sizes, resolves the model and submits; the worker runs the model.
 * Uses the 'playground' virtual project id like the rest of the canvas.
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
const MAX_SHOTS = 40
const MAX_ASSETS = 40
const MAX_FIELD_CHARS = 2_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_FIELD_CHARS) return null
  return trimmed
}

const OPTIONAL_SHOT_FIELDS = [
  'shotSize',
  'cameraMove',
  'cameraAngle',
  'lens',
  'performance',
  'blocking',
  'lighting',
  'sfx',
  'dialogue',
] as const

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const body = (await request.json()) as {
    shots?: unknown
    assets?: unknown
    globalStyle?: unknown
    locale?: unknown
  }
  const locale = (typeof body.locale === 'string' ? body.locale : 'zh') as Locale

  if (!Array.isArray(body.shots) || body.shots.length === 0 || body.shots.length > MAX_SHOTS) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SHOTS_REQUIRED',
      message: `请先确认镜头（1–${MAX_SHOTS} 个）`,
    })
  }
  const shots = body.shots.map((item, i) => {
    if (!isRecord(item)) {
      throw new ApiError('INVALID_PARAMS', { code: 'SHOT_INVALID', details: { index: i } })
    }
    const shotNumber = typeof item.shotNumber === 'number' && Number.isFinite(item.shotNumber)
      ? item.shotNumber
      : null
    const description = boundedString(item.description)
    if (shotNumber === null || !description) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'SHOT_INVALID',
        message: `镜 ${shotNumber ?? i + 1} 缺少画面描述（或超过 ${MAX_FIELD_CHARS} 字）`,
        details: { index: i },
      })
    }
    const optionalFields: Record<string, string> = {}
    for (const field of OPTIONAL_SHOT_FIELDS) {
      const value = boundedString(item[field])
      if (value) optionalFields[field] = value
    }
    return { shotNumber, description, ...optionalFields }
  })

  const rawAssets = body.assets ?? []
  if (!Array.isArray(rawAssets) || rawAssets.length > MAX_ASSETS) {
    throw new ApiError('INVALID_PARAMS', { code: 'ASSETS_INVALID' })
  }
  const assets = rawAssets.map((item, i) => {
    if (!isRecord(item)) {
      throw new ApiError('INVALID_PARAMS', { code: 'ASSET_INVALID', details: { index: i } })
    }
    const kind = typeof item.kind === 'string' ? item.kind : ''
    const name = boundedString(item.name)
    const description = boundedString(item.description)
    if (!['character', 'scene', 'prop'].includes(kind) || !name || !description) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'ASSET_INVALID',
        message: `资产 ${name ?? i + 1} 需要类型、名称与描述（各 ≤ ${MAX_FIELD_CHARS} 字）`,
        details: { index: i },
      })
    }
    return { kind, name, description }
  })

  const globalStyle = boundedString(body.globalStyle) ?? ''

  const models = await getProjectModelConfig(CANVAS_PROJECT_ID, userId)
  const model = models.analysisModel
  if (!model) {
    throw new ApiError('FORBIDDEN', {
      code: 'ANALYSIS_MODEL_NOT_CONFIGURED',
      message: '请先在 /profile 配置文本分析模型',
    })
  }

  const targetId = crypto.randomUUID()
  const inputChars = JSON.stringify({ shots, assets, globalStyle }).length
  const maxInputTokens = Math.min(12_000, Math.ceil(inputChars / 2) + 500)

  const submitted = await submitTask({
    userId,
    locale,
    projectId: CANVAS_PROJECT_ID,
    type: TASK_TYPE.CANVAS_SHOT_PROMPTS,
    targetType: 'canvas-shot-prompts',
    targetId,
    payload: {
      shots,
      assets,
      globalStyle,
      // buildTextTaskInfo checks analysisModel first, then model — set both so
      // billing identifies the model regardless of field-order refactors.
      analysisModel: model,
      model,
      maxInputTokens,
      maxOutputTokens: Math.min(8_000, shots.length * 220 + 500),
    },
  })

  _ulogInfo(
    `[canvas.shot-prompts] submitted taskId=${submitted.taskId} userId=${userId} model=${model} shots=${shots.length} assets=${assets.length}`,
  )

  return NextResponse.json({
    success: true,
    taskId: submitted.taskId,
    runId: submitted.runId ?? null,
    status: submitted.status,
  })
})
