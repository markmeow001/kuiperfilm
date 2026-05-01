/**
 * 場景多視角 (Approach B-Standard) — 管理一個 location 的多個 LocationImage 子項。
 *
 *   POST   body { locationId, viewName, description? }
 *     → 在現有 LocationImage 序列尾巴新增一筆。回傳 { image }。
 *       worker 不會自動生圖 — 前端拿到回傳後會打 regenerate-single-image
 *       觸發 worker。這個切分讓「只是先佔位 metadata」與「立即生圖」
 *       分開,前端可以做兩階段體驗。
 *
 *   DELETE ?locationId=...&imageIndex=...
 *     → 刪除非主視角的 LocationImage。imageIndex=0 拒絕刪(主視角永遠
 *       存在,要清空主視角請走 regenerate)。
 *
 * 主視角(imageIndex=0)的 viewName 留空(null)— 它就是「主場景參考圖」。
 * 額外視角(imageIndex>=1)必填 viewName,讓 panel handler 可以比對
 * panel description 抓到對應 view。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { removeLocationPromptSuffix } from '@/lib/constants'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const locationId = typeof body?.locationId === 'string' ? body.locationId.trim() : ''
  const viewName = typeof body?.viewName === 'string' ? body.viewName.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''

  if (!locationId || !viewName) {
    throw new ApiError('INVALID_PARAMS', { message: 'locationId + viewName required' })
  }

  // Multi-tenant isolation
  const owned = await prisma.novelPromotionLocation.findFirst({
    where: { id: locationId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!owned) throw new ApiError('NOT_FOUND')

  // Pick the next imageIndex — 1-based after the existing main view at 0.
  const last = await prisma.locationImage.findFirst({
    where: { locationId },
    orderBy: { imageIndex: 'desc' },
    select: { imageIndex: true },
  })
  const nextIndex = (last?.imageIndex ?? -1) + 1

  const image = await prisma.locationImage.create({
    data: {
      locationId,
      imageIndex: nextIndex,
      viewName,
      description: description ? removeLocationPromptSuffix(description) : null,
    },
  })

  return NextResponse.json({ success: true, image })
})

export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const url = new URL(request.url)
  const locationId = url.searchParams.get('locationId')?.trim() || ''
  const imageIndexRaw = url.searchParams.get('imageIndex')
  const imageIndex = imageIndexRaw === null ? NaN : Number(imageIndexRaw)

  if (!locationId || !Number.isFinite(imageIndex)) {
    throw new ApiError('INVALID_PARAMS', { message: 'locationId + imageIndex required' })
  }
  if (imageIndex === 0) {
    throw new ApiError('INVALID_PARAMS', { message: 'cannot delete main view (imageIndex=0)' })
  }

  // Multi-tenant isolation — verify the target image exists and the
  // owning location belongs to this project before deleting.
  const target = await prisma.locationImage.findFirst({
    where: {
      locationId,
      imageIndex,
      location: { novelPromotionProject: { projectId } },
    },
    select: { id: true },
  })
  if (!target) throw new ApiError('NOT_FOUND')

  await prisma.locationImage.delete({ where: { id: target.id } })
  return NextResponse.json({ success: true })
})
