/**
 * Phase 11.4 / multi-appearance — bind which CharacterAppearance an
 * episode uses for a given character. Lets users say "ep11+ Catherine
 * wears appearance B" without touching the rest of the project.
 *
 * GET    /api/novel-promotion/:projectId/episodes/:episodeId/character-appearance
 *   → { bindings: [{ characterId, appearanceId }] }
 *
 * PATCH  /api/novel-promotion/:projectId/episodes/:episodeId/character-appearance
 *   body { characterId, appearanceId | null }
 *   Upserts EpisodeCharacter for (episodeId, characterId). Setting
 *   appearanceId=null clears the override (falls back to appearance[0]).
 *
 * The character must belong to the project, the appearance must belong
 * to that character, and the episode must belong to the project — all
 * validated server-side.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const { projectId, episodeId } = await context.params

  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!episode) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })
  }

  const bindings = await prisma.episodeCharacter.findMany({
    where: { episodeId },
    select: {
      id: true,
      characterId: true,
      appearanceId: true,
      role: true,
      character: { select: { name: true } },
      appearance: {
        select: {
          id: true,
          appearanceIndex: true,
          changeReason: true,
          imageUrl: true,
        },
      },
    },
  })

  return NextResponse.json({ bindings })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const { projectId, episodeId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const characterId = typeof body?.characterId === 'string' ? body.characterId.trim() : ''
  // appearanceId can be null (clear binding) or a string id
  const rawAppearance = body?.appearanceId
  const appearanceId =
    rawAppearance === null
      ? null
      : typeof rawAppearance === 'string' && rawAppearance.trim()
        ? rawAppearance.trim()
        : undefined

  if (!characterId || appearanceId === undefined) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_FIELDS',
      message: 'characterId required; appearanceId required (string or null)',
    })
  }

  // Episode + character must both belong to this project
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!episode) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })
  }
  const character = await prisma.novelPromotionCharacter.findFirst({
    where: { id: characterId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!character) {
    throw new ApiError('NOT_FOUND', { code: 'CHARACTER_NOT_IN_PROJECT' })
  }

  // Appearance (if specified) must belong to this character
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

  const upserted = await prisma.episodeCharacter.upsert({
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
  })

  return NextResponse.json({ binding: upserted })
})
