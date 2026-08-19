import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isVoiceLineTaskOutputStorageKey } from '@/lib/voice/voice-line-output-key'

const STYLE_PROMPT_MAX_CHARS = 8000
const REFERENCE_IMAGES_MAX_COUNT = 16

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const styleProfileBodySchema = z
  .object({
    stylePositivePrompt: z
      .union([z.string().max(STYLE_PROMPT_MAX_CHARS), z.null()])
      .optional(),
    styleNegativePrompt: z
      .union([z.string().max(STYLE_PROMPT_MAX_CHARS), z.null()])
      .optional(),
    styleReferenceImages: z
      .union([
        z.array(z.string().regex(UUID_PATTERN)).max(REFERENCE_IMAGES_MAX_COUNT),
        z.null(),
      ])
      .optional(),
    stylePresetKey: z
      .union([z.string().max(64), z.null()])
      .optional(),
    // Phase B (2026-05-13) — curated 29-style library + 8-lighting picker.
    // Layers TEXT-based anchor on top of legacy stylePresetKey image-ref
    // pipeline. Both can coexist; clearing legacy doesn't clear library.
    visualStyleId: z
      .union([z.string().max(64), z.null()])
      .optional(),
    lightingPresetId: z
      .union([z.string().max(64), z.null()])
      .optional(),
  })
  .strict()

type StyleProfileBody = z.infer<typeof styleProfileBodySchema>

interface MediaObjectIdRow {
  id: string
  storageKey: string
}

/**
 * Q-005: real ownership check using MediaObject.uploadedByUserId.
 * Only return rows that belong to the requesting user; rows with NULL owner
 * (un-backfilled) are intentionally treated as not-owned to keep the cross-user
 * leak path closed even before backfill completes.
 */
async function assertReferenceImagesOwned(
  mediaIds: string[],
  userId: string,
): Promise<void> {
  if (mediaIds.length === 0) return

  const rows = (await prisma.mediaObject.findMany({
    where: {
      id: { in: mediaIds },
      uploadedByUserId: userId,
    },
    select: { id: true, storageKey: true },
  })) as unknown as MediaObjectIdRow[]

  if (rows.length !== mediaIds.length) {
    throw new ApiError('FORBIDDEN', {
      message: 'one or more reference image mediaIds are not accessible',
      requestedCount: mediaIds.length,
      accessibleCount: rows.length,
      userId,
    })
  }

  if (rows.some((row) => isVoiceLineTaskOutputStorageKey(row.storageKey))) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN',
    })
  }
}

function parseReferenceImagesField(raw: string | null | undefined): string[] | null {
  if (raw == null || raw === '') return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const ids = parsed.filter((v): v is string => typeof v === 'string' && v.length > 0)
    return ids.length > 0 ? ids : null
  } catch {
    return null
  }
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: {
      id: true,
      stylePositivePrompt: true,
      styleNegativePrompt: true,
      styleReferenceImages: true,
      stylePresetKey: true,
      visualStyleId: true,
      lightingPresetId: true,
    },
  })

  if (!novelData) {
    throw new ApiError('NOT_FOUND', {
      message: 'novel promotion data not found for this project',
    })
  }

  return NextResponse.json({
    success: true,
    data: {
      id: novelData.id,
      stylePositivePrompt: novelData.stylePositivePrompt,
      styleNegativePrompt: novelData.styleNegativePrompt,
      styleReferenceImages: parseReferenceImagesField(novelData.styleReferenceImages),
      stylePresetKey: novelData.stylePresetKey,
      visualStyleId: novelData.visualStyleId,
      lightingPresetId: novelData.lightingPresetId,
    },
  })
})

function serializeReferenceImages(value: string[] | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return JSON.stringify(value)
}

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  let parsed: StyleProfileBody
  try {
    const json = (await request.json()) as unknown
    parsed = styleProfileBodySchema.parse(json)
  } catch (err) {
    throw new ApiError('INVALID_PARAMS', {
      message: err instanceof Error ? err.message : 'invalid request body',
    })
  }

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })

  if (!novelData) {
    throw new ApiError('NOT_FOUND', {
      message: 'novel promotion data not found for this project',
    })
  }

  // owner 校验 reference images（仅当 input 包含非空数组时）
  if (Array.isArray(parsed.styleReferenceImages) && parsed.styleReferenceImages.length > 0) {
    await assertReferenceImagesOwned(parsed.styleReferenceImages, session.user.id)
  }

  // 组装 update payload — 只更新前端实际有传的字段
  const updateData: {
    stylePositivePrompt?: string | null
    styleNegativePrompt?: string | null
    styleReferenceImages?: string | null
    stylePresetKey?: string | null
    visualStyleId?: string | null
    lightingPresetId?: string | null
  } = {}

  if (parsed.stylePositivePrompt !== undefined) {
    updateData.stylePositivePrompt = parsed.stylePositivePrompt
  }
  if (parsed.styleNegativePrompt !== undefined) {
    updateData.styleNegativePrompt = parsed.styleNegativePrompt
  }
  if (parsed.styleReferenceImages !== undefined) {
    updateData.styleReferenceImages = serializeReferenceImages(parsed.styleReferenceImages) ?? null
  }
  if (parsed.stylePresetKey !== undefined) {
    updateData.stylePresetKey = parsed.stylePresetKey
  }
  if (parsed.visualStyleId !== undefined) {
    updateData.visualStyleId = parsed.visualStyleId
  }
  if (parsed.lightingPresetId !== undefined) {
    updateData.lightingPresetId = parsed.lightingPresetId
  }

  const updated = await prisma.novelPromotionProject.update({
    where: { id: novelData.id },
    data: updateData,
    select: {
      id: true,
      stylePositivePrompt: true,
      styleNegativePrompt: true,
      styleReferenceImages: true,
      stylePresetKey: true,
      visualStyleId: true,
      lightingPresetId: true,
    },
  })

  return NextResponse.json({
    success: true,
    data: {
      id: updated.id,
      stylePositivePrompt: updated.stylePositivePrompt,
      styleNegativePrompt: updated.styleNegativePrompt,
      styleReferenceImages: updated.styleReferenceImages,
      stylePresetKey: updated.stylePresetKey,
      visualStyleId: updated.visualStyleId,
      lightingPresetId: updated.lightingPresetId,
    },
  })
})
