import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

/**
 * Phase 11.2 — GET /api/projects/[projectId]/locations
 *
 * Returns project-level locations with the episodes they appear in (via the
 * EpisodeLocation junction = source of truth).
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  })
  if (!project) throw new ApiError('NOT_FOUND')
  if (project.userId !== session.user.id) throw new ApiError('FORBIDDEN')

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
