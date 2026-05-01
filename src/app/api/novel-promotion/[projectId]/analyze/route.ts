import { NextRequest } from 'next/server'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId : null

  const authResult = await requireProjectAuth(projectId, {
    include: { characters: true, locations: true },
  })
  if (isErrorResponse(authResult)) return authResult
  const { session, project } = authResult

  if (project.mode !== 'novel-promotion') {
    throw new ApiError('INVALID_PARAMS')
  }

  // Scope target to the episode when one is supplied so the V2
  // SubjectsPage status banner / button-disable logic only sees this
  // episode's analyze run, not other episodes' parallel runs. Falls
  // back to project-level scope only for the legacy "no episode"
  // global analyze (rare; pre-Stage C projects).
  //
  // Without this scope-narrowing, the frontend useTaskSnapshot query
  // matched any analyze_novel task in the project — so kicking off
  // ep1 analyze blocked the ep2 button (and vice versa) even though
  // the dedupeKey already permits parallel runs at the BullMQ layer.
  const taskTarget = episodeId
    ? { targetType: 'NovelPromotionEpisode' as const, targetId: episodeId }
    : { targetType: 'NovelPromotionProject' as const, targetId: projectId }

  const asyncTaskResponse = await maybeSubmitLLMTask({
    request,
    userId: session.user.id,
    projectId,
    episodeId,
    type: TASK_TYPE.ANALYZE_NOVEL,
    ...taskTarget,
    routePath: `/api/novel-promotion/${projectId}/analyze`,
    body: {
      ...body,
      displayMode: 'detail',
    },
    dedupeKey: `analyze_novel:${projectId}:${episodeId || 'global'}`,
    priority: 1,
  })
  if (asyncTaskResponse) return asyncTaskResponse

  throw new ApiError('INVALID_PARAMS')
})
