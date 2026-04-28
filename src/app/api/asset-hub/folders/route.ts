import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// 多人系统：团队共享 — 所有成员都能看到全部文件夹
export const GET = apiHandler(async () => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult

    const folders = await prisma.globalAssetFolder.findMany({
        orderBy: { name: 'asc' }
    })

    return NextResponse.json({ folders })
})

// 创建文件夹（editor+ 才能写共享资产库；userId 仅作为建立者审计）
export const POST = apiHandler(async (request: NextRequest) => {
    const authResult = await requireEditorAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = await request.json()
    const { name } = body

    if (!name?.trim()) {
        throw new ApiError('INVALID_PARAMS')
    }

    const folder = await prisma.globalAssetFolder.create({
        data: {
            userId: session.user.id,
            name: name.trim()
        }
    })

    return NextResponse.json({ success: true, folder })
})
