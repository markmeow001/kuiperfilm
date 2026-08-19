import { NextRequest } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import { findNovelPromotionPanelInProject } from '@/lib/novel-promotion/project-scope'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  const panelId = typeof body?.panelId === 'string' ? body.panelId.trim() : ''

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const panel = await findNovelPromotionPanelInProject(projectId, panelId)
  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }
  const requestedEpisodeId = typeof body?.episodeId === 'string' ? body.episodeId : null
  if (requestedEpisodeId && requestedEpisodeId !== panel.storyboard.episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const scopedBody = {
    ...body,
    panelId: panel.id,
    episodeId: panel.storyboard.episodeId,
  }

  const asyncTaskResponse = await maybeSubmitLLMTask({
    request,
    userId: session.user.id,
    projectId,
    episodeId: panel.storyboard.episodeId,
    type: TASK_TYPE.ANALYZE_SHOT_VARIANTS,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    routePath: `/api/novel-promotion/${projectId}/analyze-shot-variants`,
    body: scopedBody,
    dedupeKey: `analyze_shot_variants:${panel.id}`})
  if (asyncTaskResponse) return asyncTaskResponse

  throw new ApiError('INVALID_PARAMS')
})
