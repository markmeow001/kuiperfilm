import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { attachMediaFieldsToGlobalVoice } from '@/lib/media/attach'
import { rejectLegacyCustomVoiceWrite } from '@/lib/voice/legacy-custom-voice-boundary'

// 音色含可识别个人的录音来源；列表一律限于当前用户（支持 folderId 筛选）。
export const GET = apiHandler(async (request: NextRequest) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const { searchParams } = new URL(request.url)
    const folderId = searchParams.get('folderId')

    const where: Record<string, unknown> = { userId: session.user.id }
    if (folderId === 'null') {
        where.folderId = null
    } else if (folderId) {
        where.folderId = folderId
    }

    const voices = await prisma.globalVoice.findMany({
        where,
        orderBy: { createdAt: 'desc' }
    })

    const signedVoices = await Promise.all(
        voices.map((voice) => attachMediaFieldsToGlobalVoice(voice))
    )

    return NextResponse.json({ voices: signedVoices })
})

// Legacy 创建入口：editor+ 通过认证后仍须在 durable consent schema 前关闭。
export const POST = apiHandler(async (_request: NextRequest) => {
    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult

    // Deliberately before request.json(): unverified legacy voice sources must
    // never reach media resolution or GlobalVoice persistence.
    rejectLegacyCustomVoiceWrite()
})
