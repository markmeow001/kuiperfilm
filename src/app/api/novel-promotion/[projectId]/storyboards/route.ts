import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { decodePanelCharacters } from '@/lib/novel-promotion/panel-characters-decode'

/**
 * GET /api/novel-promotion/[projectId]/storyboards
 * 获取剧集的分镜数据（用于测试页面）
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const { searchParams } = new URL(request.url)
    const episodeId = searchParams.get('episodeId')

    if (!episodeId) {
        throw new ApiError('INVALID_PARAMS')
    }

    // 获取剧集的分镜数据
    const storyboards = await prisma.novelPromotionStoryboard.findMany({
        where: { episodeId },
        include: {
            clip: true,
            panels: { orderBy: { panelIndex: 'asc' } }
        },
        orderBy: { createdAt: 'asc' }
    })

    const withMedia = await attachMediaFieldsToProject({ storyboards })
    const processedStoryboards = withMedia.storyboards || storyboards

    // Decode panel.characters from raw JSON string → structured array
    // so V2/V3/V4 clients can do `panel.characters[i].name` without
    // having to JSON.parse themselves. Legacy bare-string entries
    // (older projects) and the post-2026-05-04 `{name, appearance}`
    // form are both normalised to `{name, appearance?}`. See
    // panel-characters-decode.ts for shape history.
    const normalised = (processedStoryboards as Array<{
        panels?: Array<{ characters?: string | unknown; [k: string]: unknown }>
        [k: string]: unknown
    }>).map((sb) => ({
        ...sb,
        panels: (sb.panels ?? []).map((p) => ({
            ...p,
            characters:
                typeof p.characters === 'string'
                    ? decodePanelCharacters(p.characters)
                    : Array.isArray(p.characters)
                        ? p.characters
                        : [],
        })),
    }))

    return NextResponse.json({ storyboards: normalised })
})

/**
 * PATCH /api/novel-promotion/[projectId]/storyboards
 * 清除指定 storyboard 的 lastError
 */
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json().catch(() => ({}))
    const storyboardId = typeof body?.storyboardId === 'string' ? body.storyboardId : ''
    if (!storyboardId) {
        throw new ApiError('INVALID_PARAMS')
    }

    await prisma.novelPromotionStoryboard.update({
        where: { id: storyboardId },
        data: { lastError: null }})

    return NextResponse.json({ success: true })
})
