import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// editor+ 仅可删除自己租户范围内的音色。
export const DELETE = apiHandler(async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) => {
    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const { id } = await params

    const voice = await prisma.globalVoice.findFirst({
        where: { id, userId: session.user.id }
    })

    if (!voice) {
        throw new ApiError('NOT_FOUND')
    }

    await prisma.globalVoice.delete({
        where: { id, userId: session.user.id }
    })

    return NextResponse.json({ success: true })
})

// editor+ 仅可更新自己租户范围内的音色元数据。
export const PATCH = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) => {
    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const { id } = await params
    const body = await request.json()

    const voice = await prisma.globalVoice.findFirst({
        where: { id, userId: session.user.id }
    })

    if (!voice) {
        throw new ApiError('NOT_FOUND')
    }

    if (body.folderId !== undefined && body.folderId !== null) {
        if (typeof body.folderId !== 'string' || !body.folderId.trim()) {
            throw new ApiError('INVALID_PARAMS')
        }
        const folder = await prisma.globalAssetFolder.findFirst({
            where: { id: body.folderId, userId: session.user.id },
            select: { id: true },
        })
        if (!folder) {
            throw new ApiError('INVALID_PARAMS')
        }
    }

    if (body.name !== undefined && typeof body.name !== 'string') {
        throw new ApiError('INVALID_PARAMS')
    }
    if (
        body.description !== undefined
        && body.description !== null
        && typeof body.description !== 'string'
    ) {
        throw new ApiError('INVALID_PARAMS')
    }

    const updatedVoice = await prisma.globalVoice.update({
        where: { id, userId: session.user.id },
        data: {
            name: body.name?.trim() || voice.name,
            description: body.description !== undefined ? body.description?.trim() || null : voice.description,
            folderId: body.folderId !== undefined ? body.folderId : voice.folderId
        }
    })

    return NextResponse.json({ success: true, voice: updatedVoice })
})
