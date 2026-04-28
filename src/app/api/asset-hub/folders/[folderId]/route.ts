import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// 多人系统：editor+ 可修改任何共享文件夹（不再绑定 userId）
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ folderId: string }> }
) => {
    const { folderId } = await context.params

    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json()
    const { name } = body

    if (!name?.trim()) {
        throw new ApiError('INVALID_PARAMS')
    }

    const folder = await prisma.globalAssetFolder.findUnique({
        where: { id: folderId }
    })
    if (!folder) {
        throw new ApiError('NOT_FOUND')
    }

    const updatedFolder = await prisma.globalAssetFolder.update({
        where: { id: folderId },
        data: { name: name.trim() }
    })

    return NextResponse.json({ success: true, folder: updatedFolder })
})

// 删除文件夹（editor+；删除前把内含资产 folderId 清回 null）
export const DELETE = apiHandler(async (
    _request: NextRequest,
    context: { params: Promise<{ folderId: string }> }
) => {
    const { folderId } = await context.params

    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult

    const folder = await prisma.globalAssetFolder.findUnique({
        where: { id: folderId }
    })
    if (!folder) {
        throw new ApiError('NOT_FOUND')
    }

    // 删除前，将文件夹内的资产移动到根目录（folderId = null）
    await prisma.globalCharacter.updateMany({
        where: { folderId },
        data: { folderId: null }
    })

    await prisma.globalLocation.updateMany({
        where: { folderId },
        data: { folderId: null }
    })

    // 删除文件夹
    await prisma.globalAssetFolder.delete({
        where: { id: folderId }
    })

    return NextResponse.json({ success: true })
})
