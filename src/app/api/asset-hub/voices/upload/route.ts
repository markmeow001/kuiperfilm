import { NextRequest } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { rejectLegacyCustomVoiceWrite } from '@/lib/voice/legacy-custom-voice-boundary'

/**
 * POST /api/asset-hub/voices/upload
 * Legacy 上传入口；durable consent schema 完成前关闭。
 */
export const POST = apiHandler(async (_request: NextRequest) => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult

    // Deliberately before request.formData() or File.arrayBuffer().
    rejectLegacyCustomVoiceWrite()
})
