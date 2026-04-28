import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// 多人系统：团队共享 — 任何成员都能读取场景详情
export const GET = apiHandler(async (
    _request: NextRequest,
    context: { params: Promise<{ locationId: string }> }
) => {
    const { locationId } = await context.params

    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult

    const location = await prisma.globalLocation.findUnique({
        where: { id: locationId },
        include: { images: true }
    })
    if (!location) {
        throw new ApiError('NOT_FOUND')
    }

    return NextResponse.json({ location })
})

// 更新场景（editor+）
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ locationId: string }> }
) => {
    const { locationId } = await context.params

    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult

    const location = await prisma.globalLocation.findUnique({
        where: { id: locationId }
    })
    if (!location) {
        throw new ApiError('NOT_FOUND')
    }

    const body = await request.json()
    const { name, summary, folderId } = body

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (summary !== undefined) updateData.summary = summary?.trim() || null
    if (folderId !== undefined) {
        if (folderId) {
            const folder = await prisma.globalAssetFolder.findUnique({
                where: { id: folderId }
            })
            if (!folder) {
                throw new ApiError('INVALID_PARAMS')
            }
        }
        updateData.folderId = folderId || null
    }

    const updatedLocation = await prisma.globalLocation.update({
        where: { id: locationId },
        data: updateData,
        include: { images: true }
    })

    return NextResponse.json({ success: true, location: updatedLocation })
})

// 删除场景（editor+）
export const DELETE = apiHandler(async (
    _request: NextRequest,
    context: { params: Promise<{ locationId: string }> }
) => {
    const { locationId } = await context.params

    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult

    const location = await prisma.globalLocation.findUnique({
        where: { id: locationId }
    })
    if (!location) {
        throw new ApiError('NOT_FOUND')
    }

    await prisma.globalLocation.delete({
        where: { id: locationId }
    })

    return NextResponse.json({ success: true })
})
