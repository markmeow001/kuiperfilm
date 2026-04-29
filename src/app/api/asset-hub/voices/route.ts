import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { attachMediaFieldsToGlobalVoice } from '@/lib/media/attach'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'

// 多人系统：团队共享 — 所有成员都能看到全部音色（支持 folderId 筛选）
export const GET = apiHandler(async (request: NextRequest) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult

    const { searchParams } = new URL(request.url)
    const folderId = searchParams.get('folderId')

    const where: Record<string, unknown> = {}
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

// 新建音色（editor+ 才能写共享资产库）
export const POST = apiHandler(async (request: NextRequest) => {
    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = await request.json()
    const {
        name,
        description,
        folderId,
        voiceId,
        voiceType,
        customVoiceUrl,
        voicePrompt,
        gender,
        language
    } = body

    if (!name) {
        throw new ApiError('INVALID_PARAMS')
    }

    if (folderId) {
        const folder = await prisma.globalAssetFolder.findUnique({
            where: { id: folderId }
        })
        if (!folder) {
            throw new ApiError('INVALID_PARAMS')
        }
    }

    // Q-005: tag MediaObject with the uploader so owner-checks pass downstream.
    const customVoiceMedia = await resolveMediaRefFromLegacyValue(
        customVoiceUrl || null,
        { uploadedByUserId: session.user.id },
    )
    const voice = await prisma.globalVoice.create({
        data: {
            userId: session.user.id,
            folderId: folderId || null,
            name: name.trim(),
            description: description?.trim() || null,
            voiceId: voiceId || null,
            voiceType: voiceType || 'qwen-designed',
            customVoiceUrl: customVoiceUrl || null,
            customVoiceMediaId: customVoiceMedia?.id || null,
            voicePrompt: voicePrompt?.trim() || null,
            gender: gender || null,
            language: language || 'zh'
        }
    })

    const withMedia = await attachMediaFieldsToGlobalVoice(voice)
    return NextResponse.json({ success: true, voice: withMedia })
})
