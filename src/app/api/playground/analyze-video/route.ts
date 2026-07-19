import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getUserModelConfig } from '@/lib/config-service'
import { filterAuthorizedReferences } from '@/lib/playground/reference-guard'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import type { Locale } from '@/i18n/routing'

const PROJECT_ID = 'playground'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const body = (await request.json()) as { videoKey?: unknown; locale?: unknown }
  const videoKey = typeof body.videoKey === 'string' ? body.videoKey.trim() : ''
  const locale = (typeof body.locale === 'string' ? body.locale : 'zh') as Locale
  if (!videoKey) {
    throw new ApiError('INVALID_PARAMS', { code: 'VIDEO_REQUIRED', message: '請先上傳實拍影片' })
  }

  const guarded = await filterAuthorizedReferences([videoKey], userId)
  if (guarded.rejected.length > 0 || guarded.safe.length !== 1) {
    throw new ApiError('FORBIDDEN', { code: 'VIDEO_REFERENCE_FORBIDDEN', message: '影片素材無法存取' })
  }

  const config = await getUserModelConfig(userId)
  if (!config.analysisModel) {
    throw new ApiError('FORBIDDEN', {
      code: 'ANALYSIS_MODEL_NOT_CONFIGURED',
      message: '請先到設定中心配置支援圖片理解的 AI 分析模型',
    })
  }

  const submitted = await submitTask({
    userId,
    locale,
    projectId: PROJECT_ID,
    type: TASK_TYPE.PLAYGROUND_VIDEO_ANALYZE,
    targetType: 'playground-reconstruction',
    targetId: crypto.randomUUID(),
    payload: {
      videoKey: guarded.safe[0],
      analysisModel: config.analysisModel,
      model: config.analysisModel,
      maxInputTokens: 5000,
      maxOutputTokens: 2200,
    },
  })

  return NextResponse.json({ taskId: submitted.taskId })
})
