import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
    rejectLegacyCustomVoiceWrite,
    resolveLegacyCharacterVoiceWrite,
} from '@/lib/voice/legacy-custom-voice-boundary'

interface CharacterVoiceJsonBody {
    characterId?: string
    voiceType?: string | null
    voiceId?: string | null
    customVoiceUrl?: string | null
}

interface AssetHubCharacterVoiceDb {
    globalCharacter: {
        findFirst(args: Record<string, unknown>): Promise<{ id: string } | null>
        updateMany(args: Record<string, unknown>): Promise<{ count: number }>
    }
}

/**
 * POST /api/asset-hub/character-voice
 * 上传自定义音色音频
 */
export const POST = apiHandler(async (_request: NextRequest) => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult

    // Deliberately before content-type branching, request.json(), or
    // request.formData(). Both design and upload are legacy custom sources.
    rejectLegacyCustomVoiceWrite()
})

/**
 * PATCH /api/asset-hub/character-voice
 * 更新角色音色设置
 */
export const PATCH = apiHandler(async (request: NextRequest) => {
    const db = prisma as unknown as AssetHubCharacterVoiceDb
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = (await request.json()) as CharacterVoiceJsonBody
    const { characterId } = body

    if (!characterId) {
        throw new ApiError('INVALID_PARAMS')
    }

    // 验证角色属于用户
    const character = await db.globalCharacter.findFirst({
        where: { id: characterId, userId: session.user.id }
    })
    if (!character) {
        throw new ApiError('NOT_FOUND')
    }

    const voiceWrite = resolveLegacyCharacterVoiceWrite(body)
    if (voiceWrite.kind !== 'clear') {
        throw new ApiError('INVALID_PARAMS')
    }

    const updated = await db.globalCharacter.updateMany({
        where: { id: characterId, userId: session.user.id },
        data: voiceWrite.data,
    })
    if (updated.count !== 1) throw new ApiError('NOT_FOUND')

    return NextResponse.json({ success: true })
})
