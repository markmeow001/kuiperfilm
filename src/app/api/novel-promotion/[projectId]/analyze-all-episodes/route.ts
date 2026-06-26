import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import { selectEpisodesNeedingStoryboard } from '@/lib/novel-promotion/batch-analyze'

/**
 * Per-request cap (security review 2026-06-25). The rate-limit bypass is safe
 * for the intended 70-episode use case, but without a cap a project with 500+
 * episodes would freeze billing for 500 tasks in one click. Over the cap we
 * submit the first N (lowest episode numbers) and report the rest as deferred —
 * skip-existing means the next click continues where this left off. 200 mirrors
 * MAX_EPISODES_PER_CALL in character/bind-appearance-bulk.
 */
const MAX_BATCH_EPISODES = 200

/**
 * Bounded concurrency for the submit fan-out. Each maybeSubmitLLMTask does ~8-10
 * DB/queue round trips; a flat Promise.all over 200 episodes would exhaust the
 * connection pool, while a sequential loop risks the request timing out (~14s at
 * 70 under load). 8-at-a-time keeps a 70-episode batch well under a second.
 */
const SUBMIT_CONCURRENCY = 8

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
      // Full coverage check: an episode is "done" only when every clip has a
      // storyboard (storyboards are 1-per-clip). A half-built episode (worker
      // crashed mid-build) has storyboardCount < clipCount and must NOT be
      // skipped — see selectEpisodesNeedingStoryboard.
      _count: { select: { clips: true, storyboards: true } },
    },
  })

  const { toAnalyze, skipped } = selectEpisodesNeedingStoryboard(
    episodes.map((e) => ({
      id: e.id,
      episodeNumber: e.episodeNumber,
      clipCount: e._count.clips,
      storyboardCount: e._count.storyboards,
    })),
  )

  // Cap the burst; defer the overflow to the next click (skip-existing makes a
  // re-click continue automatically once this batch's storyboards land).
  const capped = toAnalyze.slice(0, MAX_BATCH_EPISODES)
  const deferred = toAnalyze.length - capped.length

  const submitOne = async (episodeId: string): Promise<void> => {
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
    // null is unreachable for ANALYZE_NOVEL (consoleEnabled) but treat as failure
    // defensively; a same-episode conflict (cross-type task in flight) throws and
    // is counted as failed too — never abort the rest of the batch.
    if (!res) throw new Error('submit returned null')
  }

  // Bounded-concurrency fan-out (chunks of SUBMIT_CONCURRENCY).
  let submitted = 0
  let failed = 0
  for (let i = 0; i < capped.length; i += SUBMIT_CONCURRENCY) {
    const chunk = capped.slice(i, i + SUBMIT_CONCURRENCY)
    const results = await Promise.allSettled(chunk.map(submitOne))
    for (const r of results) {
      if (r.status === 'fulfilled') submitted += 1
      else failed += 1
    }
  }

  return NextResponse.json({
    success: true,
    total: episodes.length,
    submitted,
    skipped: skipped.length,
    failed,
    deferred,
  })
})
