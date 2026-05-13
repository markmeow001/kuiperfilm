/**
 * DELETE /api/novel-promotion/[projectId]/episodes/[episodeId]/storyboards/[storyboardId]
 *
 * Removes a single storyboard plus all its child panels (Prisma
 * onDelete: Cascade handles the panel rows + media-link nullification).
 *
 * Use case: a partial script_to_storyboard re-analyze left an old
 * clip's storyboard intact while sibling clips were replaced. The user
 * sees the stale panels mixed into the timeline / multi-shot view; they
 * can use the GET sibling endpoint to identify the stale storyboard's
 * id, then call DELETE here to clean it out.
 *
 * The Cascade chain:
 *   NovelPromotionStoryboard
 *     -> NovelPromotionPanel             (Cascade)
 *          -> matchedVoiceLines          (Set null on matchedPanelId)
 *          -> imageMedia / videoMedia... (Set null, MediaObject rows kept)
 *     -> SupplementaryPanel              (Cascade)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string; storyboardId: string }> },
) => {
  const { projectId, episodeId, storyboardId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const storyboard = await prisma.novelPromotionStoryboard.findUnique({
    where: { id: storyboardId },
    select: {
      id: true,
      episodeId: true,
      episode: {
        select: {
          id: true,
          novelPromotionProject: {
            select: { projectId: true },
          },
        },
      },
      panels: { select: { id: true } },
    },
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND', { code: 'STORYBOARD_NOT_FOUND' })
  }
  if (storyboard.episodeId !== episodeId) {
    throw new ApiError('NOT_FOUND', { code: 'STORYBOARD_NOT_IN_EPISODE' })
  }
  if (storyboard.episode.novelPromotionProject?.projectId !== projectId) {
    throw new ApiError('NOT_FOUND', { code: 'STORYBOARD_NOT_IN_PROJECT' })
  }

  const deletedPanelCount = storyboard.panels.length

  await prisma.novelPromotionStoryboard.delete({
    where: { id: storyboardId },
  })

  return NextResponse.json({
    deleted: true,
    storyboardId,
    deletedPanelCount,
  })
})
