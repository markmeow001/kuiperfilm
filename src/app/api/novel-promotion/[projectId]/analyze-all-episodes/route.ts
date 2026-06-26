import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import { selectEpisodesNeedingStoryboard } from '@/lib/novel-promotion/batch-analyze'

/**
 * POST — 批次「分析全部集」(2026-06-25)
 *
 * After a multi-episode script is split into N episodes, this fans out the SAME
 * analyze-with-cascade the per-episode button submits — `ANALYZE_NOVEL` with
 * { cascadeToStoryboard: true, cascadeImageGen: false } — once per episode that
 * doesn't yet have a storyboard. So a 70-episode drama gets all its storyboard
 * TEXT built in the background; the user only reviews descriptions and presses
 * generate (video stays a manual, per-group action — never auto-fired here).
 *
 * cascadeImageGen:false because the project runs R2V (Seedance segments straight
 * from the narrative) — no T2I preview images needed.
 *
 * Throttling: actual LLM load is bounded by text-worker concurrency, so we submit
 * all selected episodes at once. The per-user submit rate limit (30/min) is meant
 * for runaway UI loops, not this bounded, deduped server fan-out, so we pass
 * skipRateLimit. Each episode keeps the per-episode dedupeKey, so a re-click (or
 * an episode already queued) never double-submits.
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session, project, novelData } = authResult

  if (project.mode !== 'novel-promotion') {
    throw new ApiError('INVALID_PARAMS')
  }

  const episodes = await prisma.novelPromotionEpisode.findMany({
    where: { novelPromotionProjectId: novelData.id },
    orderBy: { episodeNumber: 'asc' },
    select: {
      id: true,
      episodeNumber: true,
      // take:1 — we only need existence, not the rows.
      storyboards: { select: { id: true }, take: 1 },
    },
  })

  const { toAnalyze, skipped } = selectEpisodesNeedingStoryboard(
    episodes.map((e) => ({
      id: e.id,
      episodeNumber: e.episodeNumber,
      hasStoryboard: e.storyboards.length > 0,
    })),
  )

  let submitted = 0
  const failedEpisodeIds: string[] = []
  for (const episodeId of toAnalyze) {
    try {
      const res = await maybeSubmitLLMTask({
        request,
        userId: session.user.id,
        projectId,
        episodeId,
        type: TASK_TYPE.ANALYZE_NOVEL,
        targetType: 'NovelPromotionEpisode',
        targetId: episodeId,
        routePath: `/api/novel-promotion/${projectId}/analyze-all-episodes`,
        body: {
          episodeId,
          cascadeToStoryboard: true,
          cascadeImageGen: false,
          displayMode: 'detail',
          // async:true mirrors the per-episode client mutation exactly so the
          // sync/async detection in maybeSubmitLLMTask takes the queue path.
          async: true,
        },
        dedupeKey: `analyze_novel:${projectId}:${episodeId}`,
        priority: 1,
        skipRateLimit: true,
      })
      if (res) submitted += 1
      else failedEpisodeIds.push(episodeId)
    } catch {
      // dedupe collision (already queued) or transient submit error — never abort
      // the rest of the batch; the user can re-click to fill the gaps.
      failedEpisodeIds.push(episodeId)
    }
  }

  return NextResponse.json({
    success: true,
    total: episodes.length,
    submitted,
    skipped: skipped.length,
    failed: failedEpisodeIds.length,
  })
})
