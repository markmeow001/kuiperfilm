import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'

function toObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

/**
 * POST /api/novel-promotion/[projectId]/generate-character-image
 * 专门用于后台触发角色图片生成的简化 API
 * 内部调用 generate-image API
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json()
    const taskLocale = resolveTaskLocale(request, body)
    const bodyMeta = toObject((body as Record<string, unknown>).meta)
    const acceptLanguage = request.headers.get('accept-language') || ''
    const { characterId, appearanceId } = body

    if (!characterId) {
        throw new ApiError('INVALID_PARAMS')
    }

    // 如果没有传 appearanceId，获取第一个 appearance 的 id
    let targetAppearanceId = appearanceId
    if (!targetAppearanceId) {
        const character = await prisma.novelPromotionCharacter.findUnique({
            where: { id: characterId },
            include: { appearances: { orderBy: { appearanceIndex: 'asc' } } }
        })
        if (!character) {
            throw new ApiError('NOT_FOUND')
        }
        const firstAppearance = character.appearances?.[0]
        if (!firstAppearance) {
            throw new ApiError('NOT_FOUND')
        }
        targetAppearanceId = firstAppearance.id
    }

    // Phase 11.5: artStylePrompt 已 deprecated（被 styleProfile 三栏取代）。
    // 此处不再写入 artStylePrompt — 风格统一由 PATCH /api/projects/{id}/style-profile 管理。

    // 调用 generate-image API
    const { getBaseUrl } = await import('@/lib/env')
    const baseUrl = getBaseUrl()
    const generateRes = await fetch(`${baseUrl}/api/novel-promotion/${projectId}/generate-image`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': request.headers.get('cookie') || '',
            ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {})
        },
        body: JSON.stringify({
            type: 'character',
            id: characterId,
            appearanceId: targetAppearanceId,  // 使用真正的 UUID
            locale: taskLocale || undefined,
            meta: {
                ...bodyMeta,
                locale: taskLocale || bodyMeta.locale || undefined,
            },
        })
    })

    const result = await generateRes.json()

    if (!generateRes.ok) {
        _ulogError('[Generate Character Image] 失败:', result.error)
        throw new ApiError('GENERATION_FAILED')
    }

    return NextResponse.json(result)
})
