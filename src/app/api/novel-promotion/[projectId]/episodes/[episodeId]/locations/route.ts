/**
 * Per-episode location bindings — parallel to character-appearance route.
 *
 * GET    /api/novel-promotion/:projectId/episodes/:episodeId/locations
 *   → { bindings: [{ locationId, role }] }
 *
 * Used by V2SubjectsClient to filter the 場景 grid to only locations
 * that actually appear in the active episode (via the EpisodeLocation
 * junction). Without this, ep1's locations leaked into ep2 and made
 * the per-episode "this episode's scenes" UX look broken.
 *
 * EpisodeLocation rows are written by:
 *   - script-to-storyboard-helpers.persistStoryboardsAndPanels (panel persist)
 *   - analyze-novel.ts (after processNewLocations, mirroring character link)
 *
 * Read-only for now — there's no per-episode location override (locations
 * don't have multi-appearance), so PATCH would have nothing to do.
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

  const bindings = await prisma.episodeLocation.findMany({
    where: { episodeId },
    select: {
      id: true,
      locationId: true,
      role: true,
      location: { select: { name: true } },
    },
  })

  return NextResponse.json({ bindings })
})
