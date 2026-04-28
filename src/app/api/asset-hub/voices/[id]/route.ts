import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// 多人系统：editor+ 可删除任何共享音色
export const DELETE = apiHandler(async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) => {
    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult

    const { id } = await params

    const voice = await prisma.globalVoice.findUnique({
        where: { id }
    })

    if (!voice) {
        throw new ApiError('NOT_FOUND')
    }

    await prisma.globalVoice.delete({
        where: { id }
    })

    return NextResponse.json({ success: true })
})

// 多人系统：editor+ 可更新任何共享音色
export const PATCH = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) => {
    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult

    const { id } = await params
    const body = await request.json()

    const voice = await prisma.globalVoice.findUnique({
        where: { id }
    })

    if (!voice) {
        throw new ApiError('NOT_FOUND')
    }

    const updatedVoice = await prisma.globalVoice.update({
        where: { id },
        data: {
            name: body.name?.trim() || voice.name,
            description: body.description !== undefined ? body.description?.trim() || null : voice.description,
            folderId: body.folderId !== undefined ? body.folderId : voice.folderId
        }
    })

    return NextResponse.json({ success: true, voice: updatedVoice })
})
