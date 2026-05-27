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
import { generateImage } from '@/lib/generator-api'
import { getSignedUrl } from '@/lib/cos'
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

  const body = await request.json().catch(() => ({}))
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
  const referenceImages = parseStringArray(rawImages, 'referenceImages', MAX_REFERENCE_IMAGES)
  const referenceVideos = parseStringArray(rawVideos, 'referenceVideos', MAX_REFERENCE_VIDEOS)
  const refText = typeof referenceText === 'string' ? referenceText.trim() : ''
  const wsId = typeof workspaceId === 'string' && workspaceId.length > 0 ? workspaceId : null

  // Phase T-1 — video not supported yet.
  if (outputType === 'video') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_NOT_YET_SUPPORTED',
      details: {
        message: 'Video output is coming in Phase T-2. Use image output for now.',
      },
    })
  }

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

  // Compose effective prompt: prompt + optional referenceText footer.
  const effectivePrompt = refText
    ? `${prompt.trim()}\n\n[參考文字 / Style hint] ${refText}`
    : prompt.trim()

  // Create row in pending state up front so failures still leave a record.
  const run = await prisma.playgroundRun.create({
    data: {
      userId,
      workspaceId: wsId,
      prompt: prompt.trim(),
      referenceImages: referenceImages.length > 0 ? JSON.stringify(referenceImages) : null,
      referenceVideos: referenceVideos.length > 0 ? JSON.stringify(referenceVideos) : null,
      referenceText: refText || null,
      outputType,
      modelKey,
      resolution: typeof resolution === 'string' ? resolution : null,
      aspectRatio: typeof aspectRatio === 'string' ? aspectRatio : null,
      durationSec: typeof durationSec === 'number' && Number.isFinite(durationSec) ? Math.round(durationSec) : null,
      generationCount: 1,
      status: 'running',
    },
  })

  _ulogInfo(
    `[playground.run] start id=${run.id} userId=${userId} model=${modelKey} refs.images=${referenceImages.length} refs.videos=${referenceVideos.length}`,
  )

  // Resolve signed URLs for reference images so the generator can fetch them.
  // Worker / generator helpers also accept raw COS keys but this gives us
  // direct interop with all image generators that expect public URLs.
  const signedRefImages = referenceImages.map((k) => getSignedUrl(k, 3600))

  try {
    const result = await generateImage(userId, modelKey, effectivePrompt, {
      ...(signedRefImages.length > 0 ? { referenceImages: signedRefImages } : {}),
      ...(typeof aspectRatio === 'string' ? { aspectRatio } : {}),
      ...(typeof resolution === 'string' ? { resolution } : {}),
    })

    if (!result.success) {
      const errMsg = result.error ?? 'image_generation_failed'
      await prisma.playgroundRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          errorMessage: errMsg,
          completedAt: new Date(),
        },
      })
      _ulogError(`[playground.run] failed id=${run.id} err=${errMsg}`)
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'GENERATION_FAILED',
        details: { runId: run.id, message: errMsg },
      })
    }

    // Result URL is whatever the generator returned (could be remote http url
    // OR a COS key — we store it raw and sign at read time if it's a key).
    const resultUrl = (result as { url?: string; imageUrl?: string }).url
      ?? (result as { url?: string; imageUrl?: string }).imageUrl
      ?? null
    if (!resultUrl) {
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'GENERATION_NO_URL',
        details: { runId: run.id },
      })
    }

    const updated = await prisma.playgroundRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        resultUrls: JSON.stringify([resultUrl]),
        completedAt: new Date(),
      },
    })

    _ulogInfo(`[playground.run] success id=${run.id} url=${resultUrl.slice(0, 60)}…`)

    // Sign the result if it's a COS key. Remote URLs pass through.
    const signedResult = resultUrl.startsWith('images/') || resultUrl.startsWith('video/')
      ? getSignedUrl(resultUrl, 3600)
      : resultUrl

    return NextResponse.json({
      success: true,
      run: {
        id: updated.id,
        status: updated.status,
        resultUrl: signedResult,
        outputType: updated.outputType,
        modelKey: updated.modelKey,
        createdAt: updated.createdAt,
        completedAt: updated.completedAt,
      },
    })
  } catch (err) {
    // generateImage throws on hard failure — record + rethrow as ApiError.
    const errMsg = err instanceof Error ? err.message : 'unknown'
    if (!(err instanceof ApiError)) {
      await prisma.playgroundRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          errorMessage: errMsg,
          completedAt: new Date(),
        },
      }).catch(() => {})
      _ulogError(`[playground.run] thrown id=${run.id} err=${errMsg}`)
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'GENERATION_THREW',
        details: { runId: run.id, message: errMsg },
      })
    }
    throw err
  }
})
