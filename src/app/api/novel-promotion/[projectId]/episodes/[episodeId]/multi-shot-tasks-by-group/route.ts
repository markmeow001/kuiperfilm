import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, requireProjectAccess } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'

/**
 * Phase V (2026-05-28) — server-side reconstruction of the
 * multi-shot-task-by-group map.
 *
 * Background: V2StoryboardClient caches the latest multi-shot taskId
 * per groupId in window.localStorage under
 *   multi-shot-task-by-group:{projectId}:{episodeId}
 * so that the chip rail / "已生成 ✓" status survives a page refresh
 * without re-running the worker. Great for the OWNER (their browser
 * stores the entries when they submit tasks). Useless for anyone else
 * (workspace teammate / admin viewing a shared project starts with
 * an empty localStorage and sees "尚未生成" on every group regardless
 * of how many videos the owner has actually generated).
 *
 * This endpoint walks the Task table for the episode, derives the
 * group association from task.payload.panelIds[0] → panel →
 * panel.multiShotGroupId, and returns the latest taskId per groupId.
 * Client merges this into taskByGroup state so the chip rail
 * reflects the real server state even for cross-user viewers.
 *
 * Auth: 8-tier cascade on the project. Read access only — this
 * endpoint exposes only taskIds, no payload / result content (those
 * are auth-guarded separately in /api/tasks/[taskId]).
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { projectId, episodeId } = await context.params

  const access = await requireProjectAccess(projectId, session.user.id, 'read')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND' || access.reason === 'NOT_AUTHENTICATED') {
      throw new ApiError('NOT_FOUND')
    }
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }

  // Build panelId → multiShotGroupId map for every panel in this
  // episode. Joins through NovelPromotionStoryboard because panels
  // belong to a storyboard which belongs to an episode.
  const panels = await prisma.novelPromotionPanel.findMany({
    where: {
      multiShotGroupId: { not: null },
      storyboard: { episodeId },
    },
    select: { id: true, multiShotGroupId: true },
  })
  const groupByPanelId = new Map<string, string>()
  for (const p of panels) {
    if (p.multiShotGroupId) groupByPanelId.set(p.id, p.multiShotGroupId)
  }
  if (groupByPanelId.size === 0) {
    return NextResponse.json({ tasksByGroup: {} })
  }

  // Pull GraphRun rows instead of Task rows. submitTask creates both
  // a Task and a Run, then OVERWRITES task.payload with runtime event
  // metadata (stage / flowId / flowStageIndex / etc.) — the original
  // panelIds gets clobbered. GraphRun.input retains the user-submitted
  // shape, so it's the only reliable source for cross-user group
  // derivation. We still return the task.id (via run.taskId) so the
  // frontend's useMultiShotTask(taskId) → /api/tasks/[id] hook keeps
  // working unchanged.
  const runs = await prisma.graphRun.findMany({
    where: { projectId, workflowType: TASK_TYPE.VIDEO_MULTI_SHOT },
    orderBy: { createdAt: 'desc' },
    select: { id: true, taskId: true, input: true },
  })

  const tasksByGroup: Record<string, string> = {}
  for (const r of runs) {
    if (!r.taskId) continue
    const input = r.input as unknown
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue
    const panelIds = (input as { panelIds?: unknown }).panelIds
    if (!Array.isArray(panelIds) || panelIds.length === 0) continue
    const firstPanelId = panelIds[0]
    if (typeof firstPanelId !== 'string') continue
    const groupId = groupByPanelId.get(firstPanelId)
    if (!groupId) continue
    if (tasksByGroup[groupId]) continue
    tasksByGroup[groupId] = r.taskId
  }

  // Brief telemetry — counts only, no PII / no full IDs. Used to verify
  // production data flow from server logs without exposing details.
  // eslint-disable-next-line no-console
  console.log(
    `[multi-shot-tasks-by-group] projectId-suffix=${projectId.slice(-6)} ` +
    `episodeId-suffix=${episodeId.slice(-6)} ` +
    `panels-with-group=${groupByPanelId.size} ` +
    `runs-found=${runs.length} ` +
    `groups-mapped=${Object.keys(tasksByGroup).length}`,
  )

  return NextResponse.json({ tasksByGroup })
})
