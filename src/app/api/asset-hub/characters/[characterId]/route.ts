import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import {
    rejectLegacyCustomVoiceWrite,
    resolveLegacyCharacterVoiceWrite,
} from '@/lib/voice/legacy-custom-voice-boundary'

// 角色详情按创建用户隔离
export const GET = apiHandler(async (
    _request: NextRequest,
    context: { params: Promise<{ characterId: string }> }
) => {
    const { characterId } = await context.params

    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const character = await prisma.globalCharacter.findFirst({
        where: { id: characterId, userId: session.user.id },
        include: { appearances: true }
    })
    if (!character) {
        throw new ApiError('NOT_FOUND')
    }

    return NextResponse.json({ character })
})

// 更新角色（editor+）
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ characterId: string }> }
) => {
    const { characterId } = await context.params

    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const character = await prisma.globalCharacter.findFirst({
        where: { id: characterId, userId: session.user.id }
    })
    if (!character) {
        throw new ApiError('NOT_FOUND')
    }

    const body = await request.json()
    const { name, aliases, profileData, profileConfirmed, folderId, globalVoiceId } = body

    const voiceWrite = resolveLegacyCharacterVoiceWrite(body)
    if (globalVoiceId !== undefined && globalVoiceId !== null) {
        rejectLegacyCustomVoiceWrite()
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (aliases !== undefined) updateData.aliases = aliases
    if (profileData !== undefined) updateData.profileData = profileData
    if (profileConfirmed !== undefined) updateData.profileConfirmed = profileConfirmed
    if (voiceWrite.kind === 'clear') {
        Object.assign(updateData, voiceWrite.data, { globalVoiceId: null })
    } else if (globalVoiceId === null) {
        updateData.globalVoiceId = null
    }
    if (folderId !== undefined) {
        if (folderId) {
            const folder = await prisma.globalAssetFolder.findFirst({
                where: { id: folderId, userId: session.user.id }
            })
            if (!folder) {
                throw new ApiError('INVALID_PARAMS')
            }
        }
        updateData.folderId = folderId || null
    }

    const updatedCharacter = await prisma.globalCharacter.update({
        where: { id: characterId, userId: session.user.id },
        data: updateData,
        include: { appearances: true }
    })

    return NextResponse.json({ success: true, character: updatedCharacter })
})

// 删除角色（editor+）
export const DELETE = apiHandler(async (
    _request: NextRequest,
    context: { params: Promise<{ characterId: string }> }
) => {
    const { characterId } = await context.params

    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const character = await prisma.globalCharacter.findFirst({
        where: { id: characterId, userId: session.user.id },
        select: { id: true }
    })
    if (!character) {
        throw new ApiError('NOT_FOUND')
    }

    await prisma.globalCharacter.delete({
        where: { id: characterId, userId: session.user.id }
    })

    return NextResponse.json({ success: true })
})
