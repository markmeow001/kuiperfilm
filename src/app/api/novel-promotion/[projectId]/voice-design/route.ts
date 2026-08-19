import { NextRequest } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { rejectLegacyCustomVoiceWrite } from '@/lib/voice/legacy-custom-voice-boundary'

/**
 * 声音设计 API（项目），durable consent schema 完成前关闭。
 * POST /api/novel-promotion/[projectId]/voice-design
 *
 * The Asset Hub twin was already closed; this endpoint produced the same
 * synthetic human voice through the same paid provider with no ownership,
 * consent, or revocation record, so it is gated the same way.
 */
export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  // Deliberately before request.json(), validation, billing, or submitTask().
  rejectLegacyCustomVoiceWrite()
})
