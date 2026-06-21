/**
 * Phase 9.1 (2026-06-20) — Playground runs history, now read off the Task
 * spine (projectId='playground'). Maps Task rows to the original
 * PlaygroundRun client shape via taskToPlaygroundRunView.
 *
 * GET /api/playground/runs?limit=20&workspaceId=...
 *   → the calling user's recent playground runs, or a workspace's shared
 *     runs (any member) when workspaceId is set. Newest first.
 *
 * Pre-9.1 PlaygroundRun rows are frozen history (decision: Task is sole
 * source of truth) and are intentionally not surfaced here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { taskToPlaygroundRunView } from '@/lib/playground/run-view'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const PLAYGROUND_PROJECT_ID = 'playground'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const limitRaw = Number.parseInt(searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, limitRaw))
    : DEFAULT_LIMIT
  const workspaceId = searchParams.get('workspaceId') || null

  // Workspace-shared mode: any member sees all runs submitted under it.
  if (workspaceId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
      select: { workspaceId: true },
    })
    const owned = await prisma.workspace.findFirst({
      where: { id: workspaceId, ownerEditorId: userId },
      select: { id: true },
    })
    if (!member && !owned) {
      throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_MEMBER' })
    }
  }

  // Workspace runs are tagged via payload.workspaceId (cross-user); personal
  // runs are scoped to the caller. projectId='playground' is exclusive to
  // playground tasks, so it alone separates them from project work.
  const tasks = await prisma.task.findMany({
    where: workspaceId
      ? { projectId: PLAYGROUND_PROJECT_ID, payload: { path: '$.workspaceId', equals: workspaceId } }
      : { projectId: PLAYGROUND_PROJECT_ID, userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const runs = tasks.map(taskToPlaygroundRunView)
  return NextResponse.json({ runs })
})
