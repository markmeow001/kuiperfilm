import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

/**
 * Phase 11.2 — GET /api/projects/[projectId]/characters
 *
 * Returns project-level characters with the episodes they appear in (via the
 * EpisodeCharacter junction = source of truth, NOT panels.characters reverse-lookup).
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
      characters: {
        include: {
          appearances: { orderBy: { appearanceIndex: 'asc' } },
          episodeCharacters: {
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

  // attach signed media URLs to the project (operates in-place on `characters`).
  const decorated = await attachMediaFieldsToProject(novelProject)

  type CharacterWithAppearances = NonNullable<typeof decorated.characters>[number] & {
    episodeCharacters: Array<{
      role: string | null
      episode: { id: string; episodeNumber: number; name: string }
    }>
  }

  const rawCharacters = (decorated.characters || []) as unknown as CharacterWithAppearances[]
  const characters = rawCharacters.map((c) => {
    const { episodeCharacters, ...rest } = c
    return {
      ...rest,
      episodes: episodeCharacters.map((ec) => ({
        id: ec.episode.id,
        episodeNumber: ec.episode.episodeNumber,
        name: ec.episode.name,
        role: ec.role,
      })),
    }
  })

  return NextResponse.json({ success: true, data: { characters } })
})
