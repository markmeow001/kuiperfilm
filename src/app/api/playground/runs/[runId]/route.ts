/**
 * Phase V (2026-05-28) — single-run status endpoint for Playground.
 *
 * GET /api/playground/runs/[runId]
 *   → polled by V2PlaygroundClient every 3s while latestRun is
 *     in pending/processing state, so the UI can flip from the
 *     "生成中…" spinner to the actual video once the worker writes
 *     the resultUrl back. Without this, video runs sat as 「尚未生成」
 *     forever because the page never re-fetched.
 *
 * Auth: same scope as the list endpoint — owner only (workspace
 * shared mode reads the list endpoint, which already gates on
 * workspace membership). This endpoint is for the run's submitter
 * watching their own job, so a single userId check is enough.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedUrl } from '@/lib/cos'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id
  const { runId } = await context.params

  const run = await prisma.playgroundRun.findUnique({ where: { id: runId } })
  if (!run) {
    throw new ApiError('NOT_FOUND')
  }
  if (run.userId !== userId) {
    // Workspace-shared runs are read through the LIST endpoint; this
    // single-run polling channel is owner-only for now to keep the
    // surface small.
    throw new ApiError('NOT_FOUND')
  }

  let resultUrls: string[] | null = null
  if (run.resultUrls) {
    try {
      const parsed = JSON.parse(run.resultUrls)
      if (Array.isArray(parsed)) {
        resultUrls = parsed.map((u) =>
          typeof u === 'string' && (u.startsWith('images/') || u.startsWith('video/'))
            ? getSignedUrl(u, 3600)
            : u,
        )
      }
    } catch {
      // Malformed JSON — ignore.
    }
  }

  return NextResponse.json({
    run: {
      id: run.id,
      prompt: run.prompt,
      outputType: run.outputType,
      modelKey: run.modelKey,
      status: run.status,
      resultUrls,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    },
  })
})
