/**
 * Phase T-1 (2026-05-27) — Playground run submission (image-only MVP).
 *
 * POST /api/playground/run
 *   body: {
 *     prompt: string,
 *     referenceImages?: string[],   // COS keys
 *     referenceVideos?: string[],   // COS keys (capped at 1 per ARK parity)
 *     referenceText?: string,
 *     outputType: 'image' | 'video',
 *     modelKey: string,             // provider::modelId
 *     resolution?: string,
 *     aspectRatio?: string,
 *     durationSec?: number,         // video only
 *     workspaceId?: string,         // null = personal
 *   }
 *   → creates PlaygroundRun row, calls generator, persists result, returns row
 *
 * Phase T-1 scope: image-only synchronous. Video output is rejected with
 * VIDEO_NOT_YET_SUPPORTED — Phase T-2 will queue it through the existing
 * 4-vendor video dispatcher.
 *
 * Synchronous design: image generation completes in 5-15s. Single
 * round-trip is simpler than queue + poll for MVP. Phase T-2 will add a
 * background job for video.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { enqueuePlaygroundImageJob, enqueuePlaygroundVideoJob } from '@/lib/playground/enqueue'
import { resolveModelSelection } from '@/lib/api-config'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

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
  // violation, not "an empty object" — return INVALID_PARAMS explicitly
  // so the caller can fix the request, instead of silently coercing into
  // the missing-field path which surfaces a misleading "PROMPT_REQUIRED".
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
    outputType,
    modelKey,
    resolution,
    aspectRatio,
    durationSec,
    workspaceId,
  } = body as {
    prompt?: unknown
    referenceImages?: unknown
    referenceVideos?: unknown
    referenceText?: unknown
    outputType?: unknown
    modelKey?: unknown
    resolution?: unknown
    aspectRatio?: unknown
    durationSec?: unknown
    workspaceId?: unknown
  }

  // Validate
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new ApiError('INVALID_PARAMS', { code: 'PROMPT_REQUIRED' })
  }
  if (prompt.length > 4000) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROMPT_TOO_LONG',
      details: { max: 4000, got: prompt.length },
    })
  }
  if (outputType !== 'image' && outputType !== 'video') {
    throw new ApiError('INVALID_PARAMS', { code: 'OUTPUT_TYPE_INVALID' })
  }
  if (typeof modelKey !== 'string' || !modelKey.trim()) {
    throw new ApiError('INVALID_PARAMS', { code: 'MODEL_KEY_REQUIRED' })
  }
  const trimmedModelKey = modelKey.trim()

  // Verify the model is in the user's enabled catalog AND matches outputType.
  // Without this, any string passes through to the worker which then either:
  //   - falls back to admin's keys (silent cross-account billing), or
  //   - errors deep in the generator with a confusing provider message.
  // resolveModelSelection threads the admin-inheritance fallback (per
  // getUserModels) and validates type — so a video modelKey + outputType=image
  // (or vice-versa) is rejected at the boundary with a clear code.
  // Mirrors the picker-side filter (feedback_picker_filter_enabled_models).
  try {
    await resolveModelSelection(userId, trimmedModelKey, outputType)
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

  const referenceImages = parseStringArray(rawImages, 'referenceImages', MAX_REFERENCE_IMAGES)
  const referenceVideos = parseStringArray(rawVideos, 'referenceVideos', MAX_REFERENCE_VIDEOS)
  const refText = typeof referenceText === 'string' ? referenceText.trim() : ''
  const wsId = typeof workspaceId === 'string' && workspaceId.length > 0 ? workspaceId : null

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

  // Create row up front so failures still leave a record. Both image and
  // video are async (2026-06-02): the row starts 'pending', the worker
  // flips it to 'running' → 'succeeded'/'failed'. The client polls
  // GET /api/playground/runs every 3s while a row is pending/running.
  const initialStatus = 'pending'
  const run = await prisma.playgroundRun.create({
    data: {
      userId,
      workspaceId: wsId,
      prompt: prompt.trim(),
      referenceImages: referenceImages.length > 0 ? JSON.stringify(referenceImages) : null,
      referenceVideos: referenceVideos.length > 0 ? JSON.stringify(referenceVideos) : null,
      referenceText: refText || null,
      outputType,
      modelKey: trimmedModelKey,
      resolution: typeof resolution === 'string' ? resolution : null,
      aspectRatio: typeof aspectRatio === 'string' ? aspectRatio : null,
      durationSec: typeof durationSec === 'number' && Number.isFinite(durationSec) ? Math.round(durationSec) : null,
      generationCount: 1,
      status: initialStatus,
    },
  })

  _ulogInfo(
    `[playground.run] start id=${run.id} userId=${userId} outputType=${outputType} model=${trimmedModelKey} refs.images=${referenceImages.length} refs.videos=${referenceVideos.length}`,
  )

  // Async dispatch (2026-06-02) — both image and video go through their
  // worker queue. The worker polls with a 15-min budget and persists the
  // result to our COS/R2, so slow async providers (e.g. AtlasCloud
  // nano-banana-pro, which polls `processing` well past 120s) complete
  // instead of the route timing out and surfacing "External service
  // failed". Client polls GET /api/playground/runs while pending/running.
  try {
    if (outputType === 'video') {
      await enqueuePlaygroundVideoJob({ playgroundRunId: run.id, userId })
    } else {
      await enqueuePlaygroundImageJob({ playgroundRunId: run.id, userId })
    }
  } catch (err) {
    // Enqueue failure is fatal — flip row to failed so the UI doesn't show
    // a stuck 'pending' forever. Re-throw so the API surfaces the problem.
    const errMsg = err instanceof Error ? err.message : 'enqueue_failed'
    try {
      await prisma.playgroundRun.update({
        where: { id: run.id },
        data: { status: 'failed', errorMessage: errMsg, completedAt: new Date() },
      })
    } catch (updateErr) {
      // Secondary failure flipping row to 'failed'. Per CLAUDE.md §3
      // (不靜默吞錯) — log explicitly instead of `.catch(() => {})`.
      // The primary enqueue error still surfaces to the client below;
      // this log lets ops reconcile the orphaned 'pending' row.
      const updateMsg = updateErr instanceof Error ? updateErr.message : String(updateErr)
      _ulogError(
        `[playground.run] FAILED to mark row failed after enqueue err id=${run.id} primary=${errMsg} secondary=${updateMsg}`,
      )
    }
    _ulogError(`[playground.run] enqueue failed id=${run.id} err=${errMsg}`)
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'PLAYGROUND_ENQUEUE_FAILED',
      details: { runId: run.id, message: errMsg },
    })
  }

  return NextResponse.json({
    success: true,
    run: {
      id: run.id,
      status: run.status,
      resultUrl: null,
      outputType: run.outputType,
      modelKey: run.modelKey,
      createdAt: run.createdAt,
      completedAt: null,
    },
  })
})
