/**
 * Phase 9.1 (2026-06-20) — Playground run submission, now on the Task spine.
 *
 * POST /api/playground/run
 *   body: { prompt, referenceImages?, referenceVideos?, referenceText?,
 *           outputType: 'image'|'video', modelKey, resolution?, aspectRatio?,
 *           durationSec?, workspaceId?, locale? }
 *   → submitTask({ projectId: 'playground', type: PLAYGROUND_IMAGE|VIDEO, ... })
 *
 * submitTask owns the whole lifecycle: billing quote+freeze (402 on
 * insufficient balance), createRun + Task row, enqueue, and rollback on
 * enqueue failure. The worker handler (withTaskLifecycle) settles billing
 * and writes the result. No bespoke PlaygroundRun row, no billing sidecar.
 *
 * projectId='playground' is a synthetic sentinel — Task.projectId has no FK,
 * and billing VIRTUAL_PROJECT_IDS already whitelists it (skips UsageCost,
 * still writes BalanceTransaction).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveModelSelection } from '@/lib/api-config'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { mapTaskStatusToPlayground } from '@/lib/playground/run-view'
import { filterSafeReferences } from '@/lib/playground/reference-guard'
import type { Locale } from '@/i18n/routing'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

const PLAYGROUND_PROJECT_ID = 'playground'
const MAX_REFERENCE_IMAGES = 9
const MAX_REFERENCE_VIDEOS = 1 // Per feedback_kuiperfilm_ref_video_lowest_common_denominator

function parseStringArray(value: unknown, fieldName: string, cap: number): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', {
      code: `${fieldName.toUpperCase()}_INVALID`,
      details: { message: `${fieldName} must be a string array` },
    })
  }
  if (value.length > cap) {
    throw new ApiError('INVALID_PARAMS', {
      code: `${fieldName.toUpperCase()}_OVER_LIMIT`,
      details: { got: value.length, max: cap },
    })
  }
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim()) {
      throw new ApiError('INVALID_PARAMS', {
        code: `${fieldName.toUpperCase()}_ENTRY_INVALID`,
      })
    }
    out.push(v.trim())
  }
  return out
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  // Per CLAUDE.md §3 (不靜默吞錯): a malformed JSON body is a contract
  // violation, not "an empty object" — return INVALID_PARAMS explicitly.
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    _ulogError(`[playground.run] invalid JSON body userId=${userId} err=${errMsg}`)
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_JSON_BODY',
      details: { message: 'request body must be valid JSON' },
    })
  }
  const {
    prompt,
    referenceImages: rawImages,
    referenceVideos: rawVideos,
    referenceText,
    lastFrameUrl: rawLastFrame,
    outputType,
    modelKey,
    resolution,
    aspectRatio,
    durationSec,
    workspaceId,
    locale: rawLocale,
  } = body as {
    prompt?: unknown
    referenceImages?: unknown
    referenceVideos?: unknown
    referenceText?: unknown
    lastFrameUrl?: unknown
    outputType?: unknown
    modelKey?: unknown
    resolution?: unknown
    aspectRatio?: unknown
    durationSec?: unknown
    workspaceId?: unknown
    locale?: unknown
  }

  // Validate. Every reject carries a human-readable `message` — ApiError falls
  // back to the generic "Invalid parameters" otherwise, which is what users
  // saw in the 6/30 生视频 bug report and could not act on.
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new ApiError('INVALID_PARAMS', { code: 'PROMPT_REQUIRED', message: '请输入提示词' })
  }
  if (prompt.length > 4000) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROMPT_TOO_LONG',
      message: `提示词过长（${prompt.length}/4000 字符），请精简后重试`,
      details: { max: 4000, got: prompt.length },
    })
  }
  if (outputType !== 'image' && outputType !== 'video') {
    throw new ApiError('INVALID_PARAMS', { code: 'OUTPUT_TYPE_INVALID', message: '输出类型无效（image/video）' })
  }
  if (typeof modelKey !== 'string' || !modelKey.trim()) {
    throw new ApiError('INVALID_PARAMS', { code: 'MODEL_KEY_REQUIRED', message: '请先选择模型' })
  }
  const trimmedModelKey = modelKey.trim()

  // Verify the model is in the user's enabled catalog AND matches outputType.
  // resolveModelSelection threads admin-inheritance + type validation, so a
  // video modelKey + outputType=image (or vice-versa) is rejected here with a
  // clear code instead of failing deep in the generator. Mirrors the picker.
  let resolvedModelId: string
  try {
    const selection = await resolveModelSelection(userId, trimmedModelKey, outputType)
    resolvedModelId = selection.modelId
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    _ulogError(
      `[playground.run] model rejected userId=${userId} modelKey=${trimmedModelKey} outputType=${outputType} err=${errMsg}`,
    )
    throw new ApiError('FORBIDDEN', {
      code: 'MODEL_NOT_ENABLED',
      details: { modelKey: trimmedModelKey, outputType, message: errMsg },
    })
  }

  const rawRefImages = parseStringArray(rawImages, 'referenceImages', MAX_REFERENCE_IMAGES)
  const rawRefVideos = parseStringArray(rawVideos, 'referenceVideos', MAX_REFERENCE_VIDEOS)
  // Optional last-frame image (首尾帧 / first-last-frame video). Single ref,
  // guarded with the same safety filter as the others.
  const rawLastFrameArr = typeof rawLastFrame === 'string' && rawLastFrame.trim()
    ? [rawLastFrame.trim()]
    : []
  // Reject foreign COS keys (cross-user read) + internal/non-https URLs (SSRF).
  // Fail explicitly rather than silently drop (CLAUDE.md §3 不静默吞错).
  const imgGuard = filterSafeReferences(rawRefImages, userId)
  const vidGuard = filterSafeReferences(rawRefVideos, userId)
  const lastFrameGuard = filterSafeReferences(rawLastFrameArr, userId)
  if (imgGuard.rejected.length > 0 || vidGuard.rejected.length > 0 || lastFrameGuard.rejected.length > 0) {
    _ulogError(
      `[playground.run] rejected unsafe references userId=${userId} images=${JSON.stringify(imgGuard.rejected)} videos=${JSON.stringify(vidGuard.rejected)} lastFrame=${JSON.stringify(lastFrameGuard.rejected)}`,
    )
    throw new ApiError('FORBIDDEN', {
      code: 'REFERENCE_NOT_ALLOWED',
      details: { message: 'reference must be your own uploaded key or an https storage URL' },
    })
  }
  const referenceImages = imgGuard.safe
  const lastFrameSafe = lastFrameGuard.safe[0] ?? null
  const referenceVideos = vidGuard.safe
  const refText = typeof referenceText === 'string' ? referenceText.trim() : ''
  const wsId = typeof workspaceId === 'string' && workspaceId.length > 0 ? workspaceId : null
  const locale = (typeof rawLocale === 'string' && rawLocale ? rawLocale : 'zh') as Locale

  // If workspaceId provided, verify membership (light check).
  if (wsId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: wsId, userId },
      select: { workspaceId: true },
    })
    const owned = await prisma.workspace.findFirst({
      where: { id: wsId, ownerEditorId: userId },
      select: { id: true },
    })
    if (!member && !owned) {
      throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_MEMBER' })
    }
  }

  let normalizedResolution = typeof resolution === 'string' ? resolution : null
  // Image models with tiered (per-resolution) pricing REQUIRE a resolution to
  // quote — a missing one used to bubble BILLING_CAPABILITY_PRICE_NOT_FOUND
  // as an opaque 500. Default to the model's first declared option (mirrors
  // resolveGenerationOptionsForModel's auto-fill on the project paths, and
  // matches the provider default, e.g. Grok 1k).
  if (!normalizedResolution && outputType === 'image') {
    const caps = resolveBuiltinCapabilitiesByModelKey('image', trimmedModelKey)
    const opts = caps?.image?.resolutionOptions
    if (opts && opts.length > 0) normalizedResolution = opts[0]
  }
  const normalizedDuration = typeof durationSec === 'number' && Number.isFinite(durationSec)
    ? Math.round(durationSec)
    : null

  const type = outputType === 'video' ? TASK_TYPE.PLAYGROUND_VIDEO : TASK_TYPE.PLAYGROUND_IMAGE
  const targetId = crypto.randomUUID()

  // payload carries everything the worker handler + billing policy need.
  // modelId (bare, resolved) feeds buildImage/VideoTaskInfo; modelKey (full)
  // feeds the generator. duration/resolution drive both billing and gen.
  const payload: Record<string, unknown> = {
    prompt: prompt.trim(),
    modelKey: trimmedModelKey,
    modelId: resolvedModelId,
    outputType,
    referenceImages,
    referenceVideos,
    ...(refText ? { referenceText: refText } : {}),
    ...(lastFrameSafe ? { lastFrameUrl: lastFrameSafe } : {}),
    ...(normalizedResolution ? { resolution: normalizedResolution } : {}),
    ...(typeof aspectRatio === 'string' ? { aspectRatio } : {}),
    ...(normalizedDuration ? { duration: normalizedDuration } : {}),
    generationCount: 1,
    ...(wsId ? { workspaceId: wsId } : {}),
  }

  // submitTask owns billing freeze (402), createRun, enqueue + rollback.
  const submitted = await submitTask({
    userId,
    locale,
    projectId: PLAYGROUND_PROJECT_ID,
    type,
    targetType: 'playground',
    targetId,
    payload,
  })

  _ulogInfo(
    `[playground.run] submitted taskId=${submitted.taskId} runId=${submitted.runId ?? 'none'} userId=${userId} type=${type} model=${trimmedModelKey}`,
  )

  return NextResponse.json({
    success: true,
    run: {
      id: submitted.taskId,
      status: mapTaskStatusToPlayground(submitted.status),
      resultUrl: null,
      outputType,
      modelKey: trimmedModelKey,
      createdAt: new Date(),
      completedAt: null,
    },
  })
})
