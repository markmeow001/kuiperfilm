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
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'

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

  // Verify the episode exists, belongs to this project, and has at least
  // one panel with a videoUrl (otherwise ffmpeg has nothing to concat).
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      novelPromotionProjectId: true,
      novelPromotionProject: { select: { projectId: true } },
      storyboards: {
        select: {
          panels: { select: { id: true, videoUrl: true } },
        },
      },
    },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })
  }
  if (episode.novelPromotionProject?.projectId !== projectId) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_IN_PROJECT' })
  }

  const panelsWithVideo = episode.storyboards
    .flatMap((sb) => sb.panels)
    .filter((p) => Boolean(p.videoUrl))

  // Multi-shot B-path episodes have empty panel.videoUrl — the playable
  // mp4 lives on the latest completed video_multi_shot task per group
  // instead. Allow the package to proceed when either source exists so
  // the worker can pull whichever videos are available.
  let multiShotTaskCount = 0
  if (panelsWithVideo.length === 0) {
    multiShotTaskCount = await prisma.task.count({
      where: {
        episodeId: episode.id,
        type: TASK_TYPE.VIDEO_MULTI_SHOT,
        status: 'completed',
      },
    })
  }

  if (panelsWithVideo.length === 0 && multiShotTaskCount === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'NO_PANEL_VIDEOS',
      details: {
        message: '此 episode 還沒有任何分鏡或多鏡頭視頻,請先生成 panel videos 或 multi-shot 群組',
      },
    })
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: episode.id,
    type: TASK_TYPE.EPISODE_STITCH_MP4,
    targetType: 'NovelPromotionEpisode',
    targetId: episode.id,
    payload: {
      episodeId: episode.id,
    },
    dedupeKey: `episode_stitch_mp4:${episode.id}`,
  })

  return NextResponse.json(result)
})
