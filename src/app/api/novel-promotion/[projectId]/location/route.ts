import { logError as _ulogError } from '@/lib/logging/core'
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

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
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
  const { name, description } = body

  if (!name || !description) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Phase 11.5: artStylePrompt 已 deprecated（被 styleProfile 三栏取代）。
  // 此处不再写入 artStylePrompt — 风格统一由 PATCH /api/projects/{id}/style-profile 管理。

  // 创建场景
  const cleanDescription = removeLocationPromptSuffix(description.trim())
  const location = await prisma.novelPromotionLocation.create({
    data: {
      novelPromotionProjectId: novelData.id,
      name: name.trim(),
      summary: body.summary?.trim() || null
    }
  })

  // 创建初始图片记录
  await prisma.locationImage.create({
    data: {
      locationId: location.id,
      imageIndex: 0,
      description: cleanDescription
    }
  })

  // 触发后台图片生成
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
  const ownedLoc = await prisma.novelPromotionLocation.findFirst({
    where: { id: locationId, novelPromotionProject: { projectId } },
    select: { id: true },
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

    const location = await prisma.novelPromotionLocation.update({
      where: { id: locationId },
      data: updateData
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
