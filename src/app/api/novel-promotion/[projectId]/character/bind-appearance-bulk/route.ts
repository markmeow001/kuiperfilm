/**
 * Phase 11.4 / multi-appearance polish — bulk bind one appearance to a
 * range / set of episodes for one character. Avoids the user having to
 * click the per-episode dropdown N times when the rule is "ep1-10 use
 * appearance A, ep11-20 use appearance B".
 *
 * POST /api/novel-promotion/:projectId/character/bind-appearance-bulk
 *   body { characterId, appearanceId | null, episodeIds: string[] }
 *
 * Wrapped in a transaction so partial failures don't leave half the
 * range bound — either all upserts succeed or none persist. Validates
 * every (episode, character, appearance) tuple inside the project
 * before writing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

const MAX_EPISODES_PER_CALL = 200 // generous; even 100-episode shows fit

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const characterId = typeof body?.characterId === 'string' ? body.characterId.trim() : ''
  const rawAppearance = body?.appearanceId
  const appearanceId =
    rawAppearance === null
      ? null
      : typeof rawAppearance === 'string' && rawAppearance.trim()
        ? rawAppearance.trim()
        : undefined
  const episodeIdsRaw = Array.isArray(body?.episodeIds) ? body.episodeIds : null

  if (!characterId || appearanceId === undefined || !episodeIdsRaw) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_FIELDS',
      message: 'characterId, appearanceId (string|null), episodeIds (array) all required',
    })
  }

  const episodeIds = episodeIdsRaw
    .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x: string) => x.trim())

  if (episodeIds.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EMPTY_EPISODE_IDS',
      message: 'episodeIds must contain at least one id',
    })
  }
  if (episodeIds.length > MAX_EPISODES_PER_CALL) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TOO_MANY_EPISODES',
      message: `episodeIds capped at ${MAX_EPISODES_PER_CALL} per call`,
    })
  }

  // Character must belong to the project.
  const character = await prisma.novelPromotionCharacter.findFirst({
    where: { id: characterId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!character) {
    throw new ApiError('NOT_FOUND', { code: 'CHARACTER_NOT_IN_PROJECT' })
  }

  // Appearance must belong to the character (when not null).
  if (appearanceId) {
    const appearance = await prisma.characterAppearance.findFirst({
      where: { id: appearanceId, characterId },
      select: { id: true },
    })
    if (!appearance) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'APPEARANCE_NOT_FOR_CHARACTER',
        message: 'appearanceId does not belong to characterId',
      })
    }
  }

  // Filter episodeIds to only those that belong to the project — silently
  // drop strays rather than 400'ing the whole call. Lets the UI pass an
  // optimistic range without verifying every id client-side.
  const projectEpisodes = await prisma.novelPromotionEpisode.findMany({
    where: { id: { in: episodeIds }, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  const validEpisodeIds = new Set(projectEpisodes.map((e) => e.id))
  const acceptedEpisodeIds = episodeIds.filter((id: string) => validEpisodeIds.has(id))

  if (acceptedEpisodeIds.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'NO_VALID_EPISODES',
      message: 'none of the provided episodeIds belong to this project',
    })
  }

  const writes = acceptedEpisodeIds.map((episodeId: string) =>
    prisma.episodeCharacter.upsert({
      where: { episodeId_characterId: { episodeId, characterId } },
      create: {
        episodeId,
        characterId,
        appearanceId,
        role: 'manual',
      },
      update: {
        appearanceId,
      },
    }),
  )
  const results = await prisma.$transaction(writes)

  return NextResponse.json({
    bound: results.length,
    requested: episodeIds.length,
    accepted: acceptedEpisodeIds.length,
    skipped: episodeIds.length - acceptedEpisodeIds.length,
  })
})
