import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { getProjectModelConfig } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)
  const storyboardId = body?.storyboardId

  if (!storyboardId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Look up the parent episodeId so the episode-level conflict guard
  // (src/lib/task/episode-conflict-matrix.ts) can refuse this task
  // when a concurrent script_to_storyboard_run / clips_build /
  // insert_panel is mutating the same episode's panel graph.
  const storyboardRef = await prisma.novelPromotionStoryboard.findUnique({
    where: { id: storyboardId },
    select: { episodeId: true },
  })
  if (!storyboardRef) {
    throw new ApiError('NOT_FOUND', { message: 'storyboard not found' })
  }

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  const billingPayload = { ...body, ...(projectModelConfig.analysisModel ? { analysisModel: projectModelConfig.analysisModel } : {}) }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: storyboardRef.episodeId,
    type: TASK_TYPE.REGENERATE_STORYBOARD_TEXT,
    targetType: 'NovelPromotionStoryboard',
    targetId: storyboardId,
    payload: billingPayload,
    dedupeKey: `regenerate_storyboard_text:${storyboardId}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.REGENERATE_STORYBOARD_TEXT, billingPayload)
  })

  return NextResponse.json(result)
})
