import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, requireProjectAccess } from '@/lib/api-auth'
import { getRunSnapshot } from '@/lib/run-runtime/service'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { runId } = await context.params

  const snapshot = await getRunSnapshot(runId)
  if (!snapshot) {
    throw new ApiError('NOT_FOUND')
  }
  // Phase V (2026-05-28) — run read auth via run.projectId so workspace
  // members / admin can see teammate-triggered runs (video generation,
  // analysis, etc). Same cascade pattern as the task GET above.
  if (snapshot.run.userId !== session.user.id) {
    if (!snapshot.run.projectId) {
      throw new ApiError('NOT_FOUND')
    }
    const access = await requireProjectAccess(
      snapshot.run.projectId,
      session.user.id,
      'read',
    )
    if (!access.allowed) {
      throw new ApiError('NOT_FOUND')
    }
  }

  return NextResponse.json(snapshot)
})

