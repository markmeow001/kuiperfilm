import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedUrl } from '@/lib/cos'
import { filterAuthorizedStorageReferences } from '@/lib/playground/reference-guard'
import {
  DepthRebuildFinalizeError,
  finalizeDepthRebuildWorkflow,
  parseDepthRebuildFinalizeInput,
} from '@/lib/live-composite/depth-rebuild-finalize'

export const runtime = 'nodejs'

const DEPTH_REBUILD_RESULT_KEY_PATTERN =
  /^video\/playground-ref\/[A-Za-z0-9_-]+\/depth-rebuild\/[A-Za-z0-9_-]+\/[a-f0-9]{24,64}\/final\.mp4$/

function toApiError(error: unknown): ApiError {
  if (!(error instanceof DepthRebuildFinalizeError)) {
    return new ApiError('GENERATION_FAILED', {
      code: 'DEPTH_REBUILD_FINALIZE_FAILED',
      message: '伺服器完稿失敗，請稍後重試',
    })
  }

  if (error.code === 'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_FOUND_OR_NOT_OWNED') {
    return new ApiError('NOT_FOUND', { code: error.code, message: error.message })
  }
  if (error.code === 'DEPTH_REBUILD_FINALIZE_SOURCE_NOT_AUTHORIZED') {
    return new ApiError('FORBIDDEN', { code: error.code, message: error.message })
  }
  if (error.code === 'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_COMPLETED') {
    return new ApiError('TASK_NOT_READY', { code: error.code, message: error.message })
  }
  if (
    error.code === 'DEPTH_REBUILD_FINALIZE_DOWNLOAD_FAILED'
    || error.code === 'DEPTH_REBUILD_FINALIZE_MEDIA_TOOL_FAILED'
    || error.code === 'DEPTH_REBUILD_FINALIZE_OUTPUT_EMPTY'
    || error.code === 'DEPTH_REBUILD_FINALIZE_OUTPUT_TOO_LARGE'
    || error.code === 'DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED'
  ) {
    return new ApiError('GENERATION_FAILED', { code: error.code, message: error.message })
  }
  return new ApiError('INVALID_PARAMS', { code: error.code, message: error.message })
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const resultKey = new URL(request.url).searchParams.get('resultKey')?.trim() ?? ''
  if (!DEPTH_REBUILD_RESULT_KEY_PATTERN.test(resultKey)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DEPTH_REBUILD_RESULT_KEY_INVALID',
      message: '深度重建結果 key 格式無效',
    })
  }
  const storageGuard = await filterAuthorizedStorageReferences(
    [resultKey],
    authResult.session.user.id,
  )
  if (storageGuard.safe.length !== 1 || storageGuard.rejected.length > 0) {
    // Do not disclose whether another user's durable object exists.
    throw new ApiError('NOT_FOUND', {
      code: 'DEPTH_REBUILD_RESULT_NOT_FOUND',
      message: '找不到可讀取的深度重建結果',
    })
  }

  const url = getSignedUrl(storageGuard.safe[0], 3600)
  return NextResponse.json({ success: true, resultKey: storageGuard.safe[0], url })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DEPTH_REBUILD_FINALIZE_INVALID_JSON',
      message: '完稿請求不是有效 JSON',
    })
  }

  try {
    const input = parseDepthRebuildFinalizeInput(body)
    const result = await finalizeDepthRebuildWorkflow(authResult.session.user.id, input)
    const resultUrl = getSignedUrl(result.resultKey)
    return NextResponse.json({
      success: true,
      // Client compatibility: the final workflow is the stable, idempotent run identity.
      runId: result.workflowId,
      url: resultUrl,
      workflowId: result.workflowId,
      resultKey: result.resultKey,
      resultUrl,
      durationSec: result.durationSec,
      inputFingerprint: result.inputFingerprint,
    })
  } catch (error) {
    throw toApiError(error)
  }
})
