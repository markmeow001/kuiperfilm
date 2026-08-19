import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { resolveAnalysisModel } from '@/lib/workers/handlers/resolve-analysis-model'
import {
  AUTO_GROUP_MAX_INPUT_TOKENS,
  AUTO_GROUP_MAX_OUTPUT_TOKENS,
  AUTO_GROUP_MAX_PANEL_COUNT,
  AUTO_GROUP_MIN_PANEL_COUNT,
} from '@/lib/novel-promotion/auto-group-multi-shot-policy'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const { projectId, episodeId } = await context.params

  const authResult = await requireProjectAuthLight(projectId, { action: 'write' })
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const locale = resolveRequiredTaskLocale(request, body as Record<string, unknown>)

  // Scope the nested episode before model resolution, billing reservation, or
  // queue submission. A foreign episode must be indistinguishable from a
  // missing one and must never create a Task.
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: {
      id: true,
      novelPromotionProject: {
        select: { analysisModel: true },
      },
      storyboards: {
        select: {
          panels: { select: { id: true } },
        },
      },
    },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_IN_PROJECT' })
  }

  const panelCount = episode.storyboards.reduce(
    (count, storyboard) => count + storyboard.panels.length,
    0,
  )
  if (panelCount < AUTO_GROUP_MIN_PANEL_COUNT) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'NOT_ENOUGH_PANELS',
      details: { panelCount },
    })
  }
  if (panelCount > AUTO_GROUP_MAX_PANEL_COUNT) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'AUTO_GROUP_PANEL_BUDGET_EXCEEDED',
      details: { panelCount, maxPanelCount: AUTO_GROUP_MAX_PANEL_COUNT },
    })
  }

  const analysisModel = await resolveAnalysisModel({
    userId: session.user.id,
    projectAnalysisModel: episode.novelPromotionProject.analysisModel,
  })

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId,
    type: TASK_TYPE.AUTO_GROUP_MULTI_SHOT,
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    payload: {
      episodeId,
      analysisModel,
      maxInputTokens: AUTO_GROUP_MAX_INPUT_TOKENS,
      maxOutputTokens: AUTO_GROUP_MAX_OUTPUT_TOKENS,
    },
    // Active-mode dedupe prevents double clicks from creating two billable
    // jobs, while a terminal task releases the key so deliberate re-grouping
    // remains possible.
    dedupeKey: `auto_group_multi_shot:${projectId}:${episodeId}`,
    // Text providers do not expose a resumable request id here. Retrying the
    // BullMQ job after a completed provider call could charge twice, so this
    // vertical intentionally uses one durable attempt.
    maxAttempts: 1,
  })

  return NextResponse.json(result)
})
