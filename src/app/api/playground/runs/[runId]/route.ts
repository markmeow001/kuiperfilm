/**
 * Phase 9.1 (2026-06-20) — single-run status endpoint, now read off the Task
 * spine (projectId='playground'). Polled by V2PlaygroundClient every 3s while
 * a run is pending/running so the UI can flip to the result once the worker
 * writes it. Maps the Task row to the original client shape.
 *
 * Auth: owner only (workspace-shared reads go through the LIST endpoint,
 * which gates on membership). A single userId check keeps the surface small.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { taskToPlaygroundRunView } from '@/lib/playground/run-view'

const PLAYGROUND_PROJECT_ID = 'playground'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id
  const { runId } = await context.params

  const task = await prisma.task.findUnique({ where: { id: runId } })
  if (!task || task.projectId !== PLAYGROUND_PROJECT_ID) {
    throw new ApiError('NOT_FOUND')
  }
  if (task.userId !== userId) {
    // Workspace-shared runs are read through the LIST endpoint; this
    // single-run polling channel is owner-only to keep the surface small.
    throw new ApiError('NOT_FOUND')
  }

  return NextResponse.json({ run: taskToPlaygroundRunView(task) })
})
