import { logError as _ulogError, logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { removeLocationPromptSuffix } from '@/lib/constants'
import {
  parseLocationSummary,
  stringifyLocationSummary,
  type LocationMetadata,
} from '@/lib/location-metadata'
import { requireProjectAuth, requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { propagateLocationRename } from '@/lib/novel-promotion/rename-propagation'
import {
  deriveManualUploadIds,
  normalizeManualUploadIdempotencyKey,
} from '@/lib/novel-promotion/manual-upload-idempotency'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function throwManualUploadReplayConflict(): never {
  throw new ApiError('CONFLICT', { code: 'MANUAL_UPLOAD_IDEMPOTENCY_CONFLICT' })
}

// 删除场景（级联删除关联的图片记录）
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('id')

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // ⚠️ Multi-user isolation: ensure the location belongs to this project.
  const owned = await prisma.novelPromotionLocation.findFirst({
    where: { id: locationId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!owned) {
    throw new ApiError('NOT_FOUND')
  }

  // 删除场景（LocationImage 会级联删除）
  await prisma.novelPromotionLocation.delete({
    where: { id: locationId }
  })

  return NextResponse.json({ success: true })
})

// 新增场景
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { novelData } = authResult

  const body = await request.json()
  const taskLocale = resolveTaskLocale(request, body)
  const bodyMeta = toObject((body as Record<string, unknown>).meta)
  const acceptLanguage = request.headers.get('accept-language') || ''
  const {
    name,
    description,
    episodeId,
    idempotencyKey: rawIdempotencyKey,
    skipImageGeneration: rawSkipImageGeneration,
  } = body

  if (typeof name !== 'string' || !name.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new ApiError('INVALID_PARAMS')
  }
  if (body.summary !== undefined && typeof body.summary !== 'string') {
    throw new ApiError('INVALID_PARAMS')
  }
  if (rawSkipImageGeneration !== undefined && typeof rawSkipImageGeneration !== 'boolean') {
    throw new ApiError('INVALID_PARAMS')
  }

  let idempotencyKey: string | null
  try {
    idempotencyKey = normalizeManualUploadIdempotencyKey(rawIdempotencyKey)
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'INVALID_IDEMPOTENCY_KEY' })
  }
  const skipImageGeneration = rawSkipImageGeneration === true

  // Phase 11.5: artStylePrompt 已 deprecated（被 styleProfile 三栏取代）。
  // 此处不再写入 artStylePrompt — 风格统一由 PATCH /api/projects/{id}/style-profile 管理。

  const trimmedDescription = typeof description === 'string' ? description.trim() : ''
  const cleanDescription = trimmedDescription ? removeLocationPromptSuffix(trimmedDescription) : ''
  const normalizedName = name.trim()
  const normalizedSummary = typeof body.summary === 'string' ? body.summary.trim() || null : null
  const normalizedEpisodeId = typeof episodeId === 'string' ? episodeId.trim() : ''
  const { location, isFirstCreate } = await prisma.$transaction(async (tx) => {
    if (normalizedEpisodeId) {
      const episode = await tx.novelPromotionEpisode.findFirst({
        where: { id: normalizedEpisodeId, novelPromotionProjectId: novelData.id },
        select: { id: true },
      })
      if (!episode) throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })
    }

    if (idempotencyKey) {
      const ids = deriveManualUploadIds('location', novelData.id, idempotencyKey)
      const inserted = await tx.novelPromotionLocation.createMany({
        data: [{
          id: ids.entityId,
          novelPromotionProjectId: novelData.id,
          name: normalizedName,
          summary: normalizedSummary,
        }],
        skipDuplicates: true,
      })
      const replayLocation = await tx.novelPromotionLocation.findUnique({
        where: { id: ids.entityId },
      })
      if (
        !replayLocation
        || replayLocation.novelPromotionProjectId !== novelData.id
        || replayLocation.name !== normalizedName
        || (replayLocation.summary ?? null) !== normalizedSummary
      ) {
        throwManualUploadReplayConflict()
      }

      const replayImage = await tx.locationImage.upsert({
        where: { id: ids.primaryAssetId },
        update: {},
        create: {
          id: ids.primaryAssetId,
          locationId: ids.entityId,
          imageIndex: 0,
          description: cleanDescription,
        },
      })
      if (
        replayImage.locationId !== ids.entityId
        || replayImage.imageIndex !== 0
        || (replayImage.description ?? '') !== cleanDescription
      ) {
        throwManualUploadReplayConflict()
      }

      const existingBinding = await tx.episodeLocation.findUnique({
        where: { id: ids.bindingId },
      })
      if (inserted.count === 0) {
        if (normalizedEpisodeId) {
          if (
            !existingBinding
            || existingBinding.episodeId !== normalizedEpisodeId
            || existingBinding.locationId !== ids.entityId
          ) {
            throwManualUploadReplayConflict()
          }
        } else if (existingBinding) {
          throwManualUploadReplayConflict()
        }
      }
      if (normalizedEpisodeId) {
        const binding = await tx.episodeLocation.upsert({
          where: { id: ids.bindingId },
          update: {},
          create: {
            id: ids.bindingId,
            episodeId: normalizedEpisodeId,
            locationId: ids.entityId,
            role: 'manual',
          },
        })
        if (
          binding.episodeId !== normalizedEpisodeId
          || binding.locationId !== ids.entityId
        ) {
          throwManualUploadReplayConflict()
        }
      }
      return {
        location: replayLocation,
        isFirstCreate: inserted.count === 1,
      }
    }

    const created = await tx.novelPromotionLocation.create({
      data: {
        novelPromotionProjectId: novelData.id,
        name: normalizedName,
        summary: normalizedSummary,
      },
    })
    await tx.locationImage.create({
      data: {
        locationId: created.id,
        imageIndex: 0,
        description: cleanDescription,
      },
    })
    if (normalizedEpisodeId) {
      await tx.episodeLocation.create({
        data: { episodeId: normalizedEpisodeId, locationId: created.id, role: 'manual' },
      })
    }
    return { location: created, isFirstCreate: true }
  })

  // 触发后台图片生成 — 仅当用户提供了 description 时。
  // 手动上传会明确传 skipImageGeneration，保留 description 但不触发 AI。
  if (cleanDescription && !skipImageGeneration && isFirstCreate) {
    const { getBaseUrl } = await import('@/lib/env')
    const baseUrl = getBaseUrl()
    fetch(`${baseUrl}/api/novel-promotion/${projectId}/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || '',
        ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}),
      },
      body: JSON.stringify({
        type: 'location',
        id: location.id,
        locale: taskLocale || undefined,
        meta: {
          ...bodyMeta,
          locale: taskLocale || bodyMeta.locale || undefined,
        },
      })
    }).catch(err => {
      _ulogError('[Location API] 后台图片生成任务触发失败:', err)
    })
  }

  // 返回包含图片的场景数据
  const locationWithImages = await prisma.novelPromotionLocation.findUnique({
    where: { id: location.id },
    include: { images: true }
  })

  return NextResponse.json({ success: true, location: locationWithImages })
})

// 更新场景（名字或图片描述）
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { locationId, imageIndex, description, name } = body

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // ⚠️ Multi-user isolation: ensure the location belongs to this project.
  // Also fetch the existing name so we can detect a rename + propagate it.
  const ownedLoc = await prisma.novelPromotionLocation.findFirst({
    where: { id: locationId, novelPromotionProject: { projectId } },
    select: { id: true, name: true },
  })
  if (!ownedLoc) {
    throw new ApiError('NOT_FOUND')
  }

  // 如果提供了 name / summary / metadata,更新場景資訊。
  // metadata(環境設置:天氣/時段/光源/色溫/標籤等)直接序列化進現有
  // summary 欄位,避免 schema migration。讀寫一律走 location-metadata
  // 模組以保持格式一致。
  if (name !== undefined || body.summary !== undefined || body.metadata !== undefined) {
    const updateData: { name?: string; summary?: string | null } = {}
    if (name !== undefined) updateData.name = name.trim()

    if (body.summary !== undefined || body.metadata !== undefined) {
      // 先讀現有的 row 拿到 (note, metadata) 基準,部分更新時不蓋掉沒
      // 動到的那一邊。例如 user 只改了天氣,不該把 note 一起清掉。
      const current = await prisma.novelPromotionLocation.findUnique({
        where: { id: locationId },
        select: { summary: true },
      })
      const baseline = parseLocationSummary(current?.summary || null)
      const nextNote =
        body.summary !== undefined
          ? typeof body.summary === 'string'
            ? body.summary.trim()
            : ''
          : baseline.note
      const nextMeta: LocationMetadata | null =
        body.metadata !== undefined
          ? body.metadata && typeof body.metadata === 'object'
            ? (body.metadata as LocationMetadata)
            : null
          : baseline.metadata
      updateData.summary = stringifyLocationSummary({ note: nextNote, metadata: nextMeta })
    }

    // Phase R-2 (2026-05-22) — propagate rename to panel.location strings.
    // panel.location stores "Name" or "Name#viewHint"; we rewrite only
    // the head segment so substring collisions (e.g. "院子" inside
    // "別院子") never trigger.
    const isRename =
      typeof updateData.name === 'string' &&
      updateData.name.length > 0 &&
      updateData.name !== ownedLoc.name
    const oldName = ownedLoc.name

    const location = await prisma.$transaction(async (tx) => {
      const updated = await tx.novelPromotionLocation.update({
        where: { id: locationId },
        data: updateData,
      })
      if (isRename) {
        const result = await propagateLocationRename(tx, projectId, oldName, updated.name)
        _ulogInfo(
          `✓ 場景改名 propagated: "${oldName}" → "${updated.name}" — ${result.panelsRewritten}/${result.panelsScanned} panels rewritten`,
        )
      }
      return updated
    })
    return NextResponse.json({ success: true, location })
  }

  // 如果提供了 description 和 imageIndex，更新图片描述
  if (imageIndex !== undefined && description) {
    const cleanDescription = removeLocationPromptSuffix(description.trim())
    const image = await prisma.locationImage.update({
      where: {
        locationId_imageIndex: { locationId, imageIndex }
      },
      data: { description: cleanDescription }
    })
    return NextResponse.json({ success: true, image })
  }

  throw new ApiError('INVALID_PARAMS')
})
