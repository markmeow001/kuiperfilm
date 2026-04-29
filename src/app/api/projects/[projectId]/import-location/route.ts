import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface ImportLocationBody {
  globalLocationId?: unknown
  includeImages?: unknown
}

/**
 * Phase 11.2 — POST /api/projects/[projectId]/import-location
 *
 * Imports a GlobalLocation (asset hub) into a project as a NovelPromotionLocation.
 * - Validates: GlobalLocation must belong to the current user (else 403).
 * - Records `sourceGlobalLocationId` for traceability.
 * - When includeImages=true, also clones GlobalLocationImage rows into LocationImage.
 *   imageMediaId is reused as-is across users — same Phase 11.5 known limitation
 *   as import-character.
 * - Does NOT touch the EpisodeLocation junction.
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true },
  })
  if (!project) throw new ApiError('NOT_FOUND')
  if (project.userId !== session.user.id) throw new ApiError('FORBIDDEN')

  const body = (await request.json()) as ImportLocationBody
  const globalLocationId = typeof body.globalLocationId === 'string' ? body.globalLocationId : null
  if (!globalLocationId) throw new ApiError('INVALID_PARAMS')
  const includeImages = body.includeImages !== false

  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) throw new ApiError('NOT_FOUND')

  const globalLocation = await prisma.globalLocation.findUnique({
    where: { id: globalLocationId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
  if (!globalLocation) throw new ApiError('NOT_FOUND')
  if (globalLocation.userId !== session.user.id) throw new ApiError('FORBIDDEN')

  type GLocationImage = (typeof globalLocation.images)[number]
  const imagesToClone: GLocationImage[] = includeImages ? globalLocation.images : []

  const created = await prisma.$transaction(async (tx) => {
    const location = await tx.novelPromotionLocation.create({
      data: {
        novelPromotionProjectId: novelProject.id,
        name: globalLocation.name,
        summary: globalLocation.summary,
        sourceGlobalLocationId: globalLocation.id,
      },
      select: { id: true },
    })

    if (imagesToClone.length > 0) {
      // NOTE (Phase 11.5 known limitation): imageMediaId copied across user
      // boundary, same as import-character. No compatibility shim — proper
      // media-ownership fix belongs in a later phase.
      await tx.locationImage.createMany({
        data: imagesToClone.map((gli) => ({
          locationId: location.id,
          imageIndex: gli.imageIndex,
          description: gli.description,
          imageUrl: gli.imageUrl,
          imageMediaId: gli.imageMediaId,
          isSelected: gli.isSelected,
          previousImageUrl: gli.previousImageUrl,
          previousDescription: gli.previousDescription,
        })),
      })
    }

    return location.id
  }, { timeout: 30000 })

  const fresh = await prisma.novelPromotionLocation.findUnique({
    where: { id: created },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })

  return NextResponse.json({ success: true, location: fresh })
})
