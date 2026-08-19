import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { getProjectModelConfig } from '@/lib/config-service'
import {
  findNovelPromotionPanelInProject,
  findNovelPromotionStoryboardInProject,
} from '@/lib/novel-promotion/project-scope'

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
  const insertAfterPanelId = body?.insertAfterPanelId

  if (!storyboardId || !insertAfterPanelId) {
    throw new ApiError('INVALID_PARAMS', {
    })
  }

  // Look up the parent episodeId so the episode-level conflict guard
  // (src/lib/task/episode-conflict-matrix.ts) can refuse this task
  // when a concurrent script_to_storyboard_run / clips_build /
  // regenerate_storyboard_text is mutating the same episode's panel
  // graph.
  const storyboardRef = await findNovelPromotionStoryboardInProject(projectId, storyboardId)
  if (!storyboardRef) {
    throw new ApiError('NOT_FOUND', { message: 'storyboard not found' })
  }

  const insertAfterPanel = await findNovelPromotionPanelInProject(projectId, insertAfterPanelId)
  if (!insertAfterPanel || insertAfterPanel.storyboardId !== storyboardRef.id) {
    throw new ApiError('NOT_FOUND', { message: 'panel not found' })
  }

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  const billingPayload = {
    ...body,
    storyboardId: storyboardRef.id,
    insertAfterPanelId: insertAfterPanel.id,
    ...(projectModelConfig.analysisModel ? { analysisModel: projectModelConfig.analysisModel } : {}),
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: storyboardRef.episodeId,
    type: TASK_TYPE.INSERT_PANEL,
    targetType: 'NovelPromotionStoryboard',
    targetId: storyboardId,
    payload: billingPayload,
    dedupeKey: `insert_panel:${storyboardId}:${insertAfterPanelId}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.INSERT_PANEL, billingPayload),
  })

  return NextResponse.json(result)
})
