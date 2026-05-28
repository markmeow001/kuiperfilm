import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

/**
 * ⚡ 延迟加载 API - 获取项目的 characters 和 locations 资产
 * 用于资产管理页面，避免首次加载时的性能开销
 *
 * Phase V (2026-05-28) — auth uses 8-tier cascade so workspace members can
 * read teammate project assets (previously hard owner check returned 403).
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const access = await requireProjectAccess(projectId, session.user.id, 'read')
    if (!access.allowed) {
        if (access.reason === 'NOT_FOUND' || access.reason === 'NOT_AUTHENTICATED') {
            throw new ApiError('NOT_FOUND')
        }
        throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
    }

    // 获取 characters 和 locations（包含嵌套数据）
    const novelPromotionData = await prisma.novelPromotionProject.findUnique({
        where: { projectId },
        include: {
            characters: {
                include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
                orderBy: { createdAt: 'asc' }
            },
            locations: {
                include: { images: { orderBy: { imageIndex: 'asc' } } },
                orderBy: { createdAt: 'asc' }
            }
        }
    })

    if (!novelPromotionData) {
        throw new ApiError('NOT_FOUND')
    }

    // 转换为稳定媒体 URL（并保留兼容字段）
    const dataWithSignedUrls = await attachMediaFieldsToProject(novelPromotionData)

    return NextResponse.json({
        characters: dataWithSignedUrls.characters || [],
        locations: dataWithSignedUrls.locations || []
    })
})
