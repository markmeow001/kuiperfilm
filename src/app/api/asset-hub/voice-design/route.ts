import { NextRequest } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { rejectLegacyCustomVoiceWrite } from '@/lib/voice/legacy-custom-voice-boundary'

/**
 * Legacy 声音设计 API (Asset Hub)，durable consent schema 完成前关闭。
 * POST /api/asset-hub/voice-design
 */
export const POST = apiHandler(async (_request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  // Deliberately before request.json(), validation, billing, or submitTask().
  rejectLegacyCustomVoiceWrite()
})
