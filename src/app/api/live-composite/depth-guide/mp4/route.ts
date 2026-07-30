import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  DepthGuideTranscodeError,
  assertDepthGuideTranscodeInput,
  transcodeDepthGuideToMp4,
} from '@/lib/live-composite/depth-guide-transcode'

export const runtime = 'nodejs'

/**
 * 本機深度引導影片（MediaRecorder WebM）→ MP4 下載轉檔。
 *
 * 只服務「下載檢視」：生成鏈路由 worker 的 ffmpeg 正規化負責，與此無關。
 * 同步轉檔（4–15 秒素材約 1–3 秒），與 depth-rebuild/finalize 同一模式。
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const contentType = request.headers.get('content-type') ?? ''
  const body = Buffer.from(await request.arrayBuffer())
  try {
    assertDepthGuideTranscodeInput(body.byteLength, contentType)
    const mp4 = await transcodeDepthGuideToMp4(body)
    return new NextResponse(new Uint8Array(mp4), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="depth-guide.mp4"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof DepthGuideTranscodeError) {
      const isInputIssue = error.code === 'DEPTH_GUIDE_TRANSCODE_INPUT_EMPTY'
        || error.code === 'DEPTH_GUIDE_TRANSCODE_INPUT_TOO_LARGE'
        || error.code === 'DEPTH_GUIDE_TRANSCODE_CONTENT_TYPE_INVALID'
      throw new ApiError(isInputIssue ? 'INVALID_PARAMS' : 'GENERATION_FAILED', {
        code: error.code,
        message: error.message,
      })
    }
    throw error
  }
})
