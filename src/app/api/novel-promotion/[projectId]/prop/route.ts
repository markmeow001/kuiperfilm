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
import { attachMediaFieldsToProp } from '@/lib/media/attach'
import { propagatePropRename } from '@/lib/novel-promotion/rename-propagation'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
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

  // Sign each prop's imageUrl. The worker stores raw COS keys
  // (`images/prop-...jpg`) which the browser would 404 if rendered as
  // a relative URL. attachMediaFieldsToProp routes through
  // resolveMediaRef so the FE receives a signed COS URL ready to
  // <img src=...>.
  const propsWithSignedUrls = await Promise.all(
    (props as unknown as Array<Record<string, unknown>>).map(attachMediaFieldsToProp),
  )

  return NextResponse.json({ props: propsWithSignedUrls })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const { name, summary, episodeId } = body as {
    name?: unknown
    summary?: unknown
    episodeId?: unknown
  }

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

  const normalizedEpisodeId = typeof episodeId === 'string' ? episodeId.trim() : ''
  const prop = await prisma.$transaction(async (tx) => {
    if (normalizedEpisodeId) {
      const episode = await tx.novelPromotionEpisode.findFirst({
        where: { id: normalizedEpisodeId, novelPromotionProjectId: npProject.id },
        select: { id: true },
      })
      if (!episode) throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })
    }

    const created = await tx.novelPromotionProp.create({
      data: {
        novelPromotionProjectId: npProject.id,
        name: name.trim(),
        summary: typeof summary === 'string' ? summary.trim() || null : null,
      },
    })
    if (normalizedEpisodeId) {
      await tx.episodeProp.create({
        data: { episodeId: normalizedEpisodeId, propId: created.id, role: 'manual' },
      })
    }
    return created
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

  // Multi-user isolation: chain ownership + capture old name for propagation.
  const owned = await prisma.novelPromotionProp.findFirst({
    where: { id: propId, novelPromotionProject: { projectId } },
    select: { id: true, name: true },
  })
  if (!owned) {
    throw new ApiError('NOT_FOUND')
  }

  // Phase R-2 (2026-05-22) — propagate prop rename to panel.props JSON
  // refs (same shape as character refs). Same atomicity guarantee as
  // character / location PATCH.
  const isRename =
    typeof updateData.name === 'string' &&
    updateData.name.length > 0 &&
    updateData.name !== owned.name
  const oldName = owned.name

  const prop = await prisma.$transaction(async (tx) => {
    const updated = await tx.novelPromotionProp.update({
      where: { id: propId },
      data: updateData,
    })
    if (isRename) {
      const result = await propagatePropRename(tx, projectId, oldName, updated.name)
      _ulogInfo(
        `✓ 道具改名 propagated: "${oldName}" → "${updated.name}" — ${result.panelsRewritten}/${result.panelsScanned} panels rewritten`,
      )
    }
    return updated
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
