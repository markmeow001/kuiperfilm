import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

/**
 * Phase 11.2 — GET /api/projects/[projectId]/characters
 *
 * Returns project-level characters with the episodes they appear in (via the
 * EpisodeCharacter junction = source of truth, NOT panels.characters reverse-lookup).
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
