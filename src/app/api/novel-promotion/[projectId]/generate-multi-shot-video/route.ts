import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  if (!isRecord(body)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const locale = resolveRequiredTaskLocale(request, body)

  // Validate panelIds
  const panelIds = body.panelIds
  if (!Array.isArray(panelIds) || panelIds.length < 2 || panelIds.length > 6) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PANEL_IDS_INVALID',
      field: 'panelIds',
      details: { message: 'panelIds must be an array of 2-6 panel IDs' },
    })
  }

  for (const id of panelIds) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PANEL_IDS_INVALID',
        field: 'panelIds',
      })
    }
  }

  // Validate videoModel
  const videoModel = body.videoModel
  if (typeof videoModel !== 'string' || !videoModel.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_MODEL_REQUIRED',
      field: 'videoModel',
    })
  }

  // Verify all panels exist and have imageUrl
  const panels = await prisma.novelPromotionPanel.findMany({
    where: { id: { in: panelIds } },
    select: { id: true, imageUrl: true, storyboardId: true },
  })

  if (panels.length !== panelIds.length) {
    throw new ApiError('NOT_FOUND', {
      code: 'PANELS_NOT_FOUND',
      details: { expected: panelIds.length, found: panels.length },
    })
  }

  // Panel imageUrl is required only on the C path (KieAI / image-to-video).
  // On the B path (Tencent VOD Kling-3 / Omni with multi_shot=intelligence)
  // the model is text-to-video and SubjectInfos.N carries the per-character
  // reference, so we accept text-only panels. Detect by videoModel string —
  // mirrors shouldUseTencentBPath in the worker handler.
  const isBPath = /^tencent-vod::Kling-(3|O1)/i.test(videoModel)
  if (!isBPath) {
    const panelsWithoutImage = panels.filter((p) => !p.imageUrl)
    if (panelsWithoutImage.length > 0) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PANELS_MISSING_IMAGE',
        details: {
          panelIds: panelsWithoutImage.map((p) => p.id),
          message: 'All panels must have a generated image before multi-shot video generation',
        },
      })
    }
  }

  // Use the storyboard of the first panel as target
  const storyboard = await prisma.novelPromotionStoryboard.findFirst({
    where: { id: panels[0].storyboardId },
    select: { id: true, episodeId: true },
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND', {
      code: 'STORYBOARD_NOT_FOUND',
    })
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: storyboard.episodeId,
    type: TASK_TYPE.VIDEO_MULTI_SHOT,
    targetType: 'NovelPromotionStoryboard',
    targetId: storyboard.id,
    payload: {
      panelIds,
      videoModel,
      mode: typeof body.mode === 'string' ? body.mode : undefined,
      sound: typeof body.sound === 'boolean' ? body.sound : undefined,
      aspectRatio: typeof body.aspectRatio === 'string' ? body.aspectRatio : undefined,
    },
    dedupeKey: `video_multi_shot:${storyboard.id}`,
  })

  return NextResponse.json(result)
})
