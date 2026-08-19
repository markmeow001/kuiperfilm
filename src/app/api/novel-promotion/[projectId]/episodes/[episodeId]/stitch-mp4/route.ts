/**
 * Phase 12.7.x — POST /api/novel-promotion/[projectId]/episodes/[episodeId]/stitch-mp4
 *
 * Submits an EPISODE_STITCH_MP4 task to the video queue. Despite the
 * legacy route name, the worker now packages every panel video +
 * storyboard image + dialogue script into a single zip and uploads it.
 * The output zip key is written back to `episode.stitchedVideoUrl`
 * (column name preserved to avoid migration). Final cutting happens
 * in CapCut/剪映 on the user's machine — the server no longer runs
 * ffmpeg.
 *
 * Returns the standard task envelope so the client can resolve via
 * resolveTaskResponse / poll runs status.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { EpisodeDeliverySourceError } from '@/lib/novel-promotion/final-delivery'
import { getEpisodeDeliveryInputSnapshot } from '@/lib/novel-promotion/episode-delivery-snapshot'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const { projectId, episodeId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const locale = resolveRequiredTaskLocale(request, body as Record<string, unknown>)

  let snapshot
  try {
    snapshot = await getEpisodeDeliveryInputSnapshot(projectId, episodeId)
  } catch (error) {
    if (error instanceof EpisodeDeliverySourceError) {
      throw new ApiError('INVALID_PARAMS', { code: 'EPISODE_DELIVERY_SOURCE_INVALID' })
    }
    throw error
  }
  if (!snapshot) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })
  }
  if (!snapshot.input.canCreate) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'NO_DELIVERY_INPUTS',
    })
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: snapshot.episode.id,
    type: TASK_TYPE.EPISODE_STITCH_MP4,
    targetType: 'NovelPromotionEpisode',
    targetId: snapshot.episode.id,
    payload: {
      episodeId: snapshot.episode.id,
      sourceFingerprint: snapshot.sourceFingerprint,
    },
    dedupeKey: `episode_stitch_mp4:${snapshot.episode.id}`,
  })

  return NextResponse.json(result)
})
