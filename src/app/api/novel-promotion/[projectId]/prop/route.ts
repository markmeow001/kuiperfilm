/**
 * Phase 11.3 — Per-project Prop CRUD.
 *
 * GET    /api/novel-promotion/:projectId/prop
 *        → { props: NovelPromotionProp[] }
 * POST   /api/novel-promotion/:projectId/prop  body { name, summary? }
 *        → creates a new prop on the project (manual)
 * PATCH  /api/novel-promotion/:projectId/prop  body { propId, name?, summary? }
 * DELETE /api/novel-promotion/:projectId/prop?id=<propId>
 *
 * All routes enforce multi-user isolation:
 *   - requireProjectAuthLight verifies session.user owns the project
 *   - findFirst with project chain rejects propIds from other projects
 *
 * Image generation: clients call POST /api/asset-hub/generate-image with
 * type='prop' once that handler ships. Lazy by design — props don't
 * always need an image.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const npProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!npProject) {
    throw new ApiError('NOT_FOUND', { code: 'NOVEL_PROMOTION_NOT_FOUND' })
  }

  const props = await prisma.novelPromotionProp.findMany({
    where: { novelPromotionProjectId: npProject.id },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ props })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const { name, summary } = body as { name?: unknown; summary?: unknown }

  if (typeof name !== 'string' || !name.trim()) {
    throw new ApiError('INVALID_PARAMS', { message: 'name is required' })
  }

  const npProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!npProject) {
    throw new ApiError('NOT_FOUND', { code: 'NOVEL_PROMOTION_NOT_FOUND' })
  }

  const prop = await prisma.novelPromotionProp.create({
    data: {
      novelPromotionProjectId: npProject.id,
      name: name.trim(),
      summary: typeof summary === 'string' ? summary.trim() || null : null,
    },
  })

  return NextResponse.json({ success: true, prop })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const { propId, name, summary } = body as {
    propId?: unknown
    name?: unknown
    summary?: unknown
  }

  if (typeof propId !== 'string' || !propId) {
    throw new ApiError('INVALID_PARAMS', { code: 'PROP_ID_REQUIRED' })
  }

  const updateData: { name?: string; summary?: string | null } = {}
  if (typeof name === 'string' && name.trim()) updateData.name = name.trim()
  if (typeof summary === 'string') updateData.summary = summary.trim() || null
  else if (summary === null) updateData.summary = null

  if (Object.keys(updateData).length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: 'no updatable fields' })
  }

  // Multi-user isolation: chain ownership
  const owned = await prisma.novelPromotionProp.findFirst({
    where: { id: propId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!owned) {
    throw new ApiError('NOT_FOUND')
  }

  const prop = await prisma.novelPromotionProp.update({
    where: { id: propId },
    data: updateData,
  })

  return NextResponse.json({ success: true, prop })
})

export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const propId = searchParams.get('id')

  if (!propId) {
    throw new ApiError('INVALID_PARAMS', { code: 'PROP_ID_REQUIRED' })
  }

  const owned = await prisma.novelPromotionProp.findFirst({
    where: { id: propId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!owned) {
    throw new ApiError('NOT_FOUND')
  }

  await prisma.novelPromotionProp.delete({ where: { id: propId } })

  return NextResponse.json({ success: true })
})
