import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, requireProjectAccess } from '@/lib/api-auth'
import { cancelTask } from '@/lib/task/service'
import { getRunById, requestRunCancel } from '@/lib/run-runtime/service'
import { publishRunEvent } from '@/lib/run-runtime/publisher'
import { RUN_EVENT_TYPE, RUN_STATUS } from '@/lib/run-runtime/types'

export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { runId } = await context.params

  const run = await getRunById(runId)
  if (!run) {
    throw new ApiError('NOT_FOUND')
  }
  // Phase V (2026-05-28) — run cancel via cascade (write action). Owner /
  // admin / ws_owner / editor collaborators can cancel teammate runs;
  // viewer cannot.
  if (run.userId !== session.user.id) {
    if (!run.projectId) {
      throw new ApiError('NOT_FOUND')
    }
    const access = await requireProjectAccess(run.projectId, session.user.id, 'write')
    if (!access.allowed) {
      throw new ApiError('NOT_FOUND')
    }
  }

  if (run.taskId) {
    const taskCancellation = await cancelTask(run.taskId, 'Run cancelled by user')
    if (!taskCancellation.task) {
      throw new ApiError('NOT_FOUND')
    }
    if (taskCancellation.providerHandoffProtected) {
      throw new ApiError('CONFLICT', {
        code: 'VOICE_PROVIDER_CANCEL_RECONCILIATION_REQUIRED',
        message: 'Voice provider request is already in progress and cannot be safely cancelled',
      })
    }
  }

  const cancelledRun = await requestRunCancel({
    runId,
    // requestRunCancel scopes the mutation to the run owner. Authorization
    // above decides whether a collaborator may perform this write.
    userId: run.userId,
  })
  if (!cancelledRun) {
    throw new ApiError('NOT_FOUND')
  }

  if (
    cancelledRun.status === RUN_STATUS.CANCELING ||
    cancelledRun.status === RUN_STATUS.CANCELED
  ) {
    await publishRunEvent({
      runId: cancelledRun.id,
      projectId: cancelledRun.projectId,
      userId: cancelledRun.userId,
      eventType: RUN_EVENT_TYPE.RUN_CANCELED,
      payload: {
        message: 'Run cancelled by user',
      },
    })
  }

  return NextResponse.json({
    success: true,
    run: cancelledRun,
  })
})
