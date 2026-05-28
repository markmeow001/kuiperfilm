import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

/**
 * Phase 11.2 — GET /api/projects/[projectId]/locations
 *
 * Returns project-level locations with the episodes they appear in (via the
 * EpisodeLocation junction = source of truth).
 *
 * Phase V (2026-05-28) — auth uses 8-tier cascade so workspace members can
 * read teammate projects (previously hard owner check returned 403).
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const access = await requireProjectAccess(projectId, session.user.id, 'read')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND' || access.reason === 'NOT_AUTHENTICATED') {
      throw new ApiError('NOT_FOUND')
    }
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }

  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      locations: {
        include: {
          images: { orderBy: { imageIndex: 'asc' } },
          episodeLocations: {
            include: {
              episode: { select: { id: true, episodeNumber: true, name: true } },
            },
            orderBy: { episode: { episodeNumber: 'asc' } },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!novelProject) throw new ApiError('NOT_FOUND')

  const decorated = await attachMediaFieldsToProject(novelProject)

  type LocationWithImages = NonNullable<typeof decorated.locations>[number] & {
    episodeLocations: Array<{
      role: string | null
      episode: { id: string; episodeNumber: number; name: string }
    }>
  }

  const rawLocations = (decorated.locations || []) as unknown as LocationWithImages[]
  const locations = rawLocations.map((l) => {
    const { episodeLocations, ...rest } = l
    return {
      ...rest,
      episodes: episodeLocations.map((el) => ({
        id: el.episode.id,
        episodeNumber: el.episode.episodeNumber,
        name: el.episode.name,
        role: el.role,
      })),
    }
  })

  return NextResponse.json({ success: true, data: { locations } })
})
