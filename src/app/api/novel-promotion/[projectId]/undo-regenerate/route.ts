import { logError as _ulogError } from '@/lib/logging/core'
/**
 * 撤回重新生成的图片，恢复到上一版本
 * POST /api/novel-promotion/[projectId]/undo-regenerate
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteCOSObject } from '@/lib/cos'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
    findCharacterAppearanceInProject,
    findNovelPromotionLocationInProject,
    findNovelPromotionPanelInProject,
    novelPromotionLocationImageInProjectWhere,
    NovelPromotionProjectScopeError,
    updateCharacterAppearanceInProject,
    updateNovelPromotionPanelInProject,
} from '@/lib/novel-promotion/project-scope'

export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const { type, id, appearanceId } = await request.json()

    // 🔒 UUID 格式验证辅助函数
    const isValidUUID = (str: unknown): boolean => {
        if (typeof str !== 'string') return false
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        return uuidRegex.test(str)
    }

    if (!type || !id) {
        throw new ApiError('INVALID_PARAMS')
    }

    if (type === 'character') {
        // 🔒 验证 appearanceId 是有效的 UUID
        if (!appearanceId || !isValidUUID(appearanceId)) {
            _ulogError(`[undo-regenerate] 收到无效的 appearanceId: ${appearanceId} (类型: ${typeof appearanceId})`)
            throw new ApiError('INVALID_PARAMS')
        }
        return await undoCharacterRegenerate(projectId, id, appearanceId)
    } else if (type === 'location') {
        return await undoLocationRegenerate(projectId, id)
    } else if (type === 'panel') {
        return await undoPanelRegenerate(projectId, id)
    }

    throw new ApiError('INVALID_PARAMS')
})

async function undoCharacterRegenerate(
    projectId: string,
    characterId: string,
    appearanceId: string,
) {
    const appearance = await findCharacterAppearanceInProject(projectId, appearanceId)

    if (!appearance || appearance.characterId !== characterId) {
        throw new ApiError('NOT_FOUND')
    }

    const previousImageUrls = decodeImageUrlsFromDb(appearance.previousImageUrls, 'characterAppearance.previousImageUrls')

    // 检查是否有上一版本
    if (!appearance.previousImageUrl && previousImageUrls.length === 0) {
        throw new ApiError('INVALID_PARAMS')
    }

    const currentImageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
    const restoredImageUrls = previousImageUrls.length > 0
        ? previousImageUrls
        : (appearance.previousImageUrl ? [appearance.previousImageUrl] : [])

    try {
        await updateCharacterAppearanceInProject(projectId, appearance.id, {
            imageUrl: appearance.previousImageUrl || restoredImageUrls[0] || null,
            imageUrls: encodeImageUrls(restoredImageUrls),
            previousImageUrl: null,
            previousImageUrls: encodeImageUrls([]),
            selectedIndex: null,
            description: appearance.previousDescription ?? appearance.description,
            descriptions: appearance.previousDescriptions ?? appearance.descriptions,
            previousDescription: null,
            previousDescriptions: null,
        })
    } catch (error) {
        rethrowProjectScopeAsNotFound(error)
    }

    await deleteSupersededImages(currentImageUrls, new Set(restoredImageUrls))

    return NextResponse.json({
        success: true,
        message: '已撤回到上一版本（图片和描述词）'
    })
}

async function undoLocationRegenerate(projectId: string, locationId: string) {
    const location = await findNovelPromotionLocationInProject(projectId, locationId)

    if (!location) {
        throw new ApiError('NOT_FOUND')
    }

    // 检查是否有上一版本
    const hasPrevious = location.images?.some((img) => img.previousImageUrl)
    if (!hasPrevious) {
        throw new ApiError('INVALID_PARAMS')
    }

    const restoredImages = location.images.filter((image) => image.previousImageUrl)
    try {
        await prisma.$transaction(async (tx) => {
            for (const img of restoredImages) {
                const result = await tx.locationImage.updateMany({
                    where: novelPromotionLocationImageInProjectWhere(projectId, img.id),
                    data: {
                        imageUrl: img.previousImageUrl,
                        previousImageUrl: null,
                        description: img.previousDescription ?? img.description,
                        previousDescription: null,
                    },
                })
                if (result.count !== 1) {
                    throw new NovelPromotionProjectScopeError('location-image', img.id, projectId)
                }
            }
        })
    } catch (error) {
        rethrowProjectScopeAsNotFound(error)
    }

    for (const img of restoredImages) {
        const restoredImageUrl = img.previousImageUrl
        if (restoredImageUrl && img.imageUrl && img.imageUrl !== restoredImageUrl) {
            await deleteSupersededImages([img.imageUrl], new Set([restoredImageUrl]))
        }
    }

    return NextResponse.json({
        success: true,
        message: '已撤回到上一版本（图片和描述词）'
    })
}

/**
 * 撤回 Panel 镜头图片到上一版本
 */
async function undoPanelRegenerate(projectId: string, panelId: string) {
    const panel = await findNovelPromotionPanelInProject(projectId, panelId)

    if (!panel) {
        throw new ApiError('NOT_FOUND')
    }

    // 检查是否有上一版本
    if (!panel.previousImageUrl) {
        throw new ApiError('INVALID_PARAMS')
    }

    // 恢复上一版本
    try {
        await updateNovelPromotionPanelInProject(projectId, panel.id, {
            imageUrl: panel.previousImageUrl,
            previousImageUrl: null,
            candidateImages: null,
        })
    } catch (error) {
        rethrowProjectScopeAsNotFound(error)
    }

    if (panel.imageUrl && panel.imageUrl !== panel.previousImageUrl) {
        await deleteSupersededImages([panel.imageUrl], new Set([panel.previousImageUrl]))
    }

    return NextResponse.json({
        success: true,
        message: '镜头图片已撤回到上一版本'
    })
}

function rethrowProjectScopeAsNotFound(error: unknown): never {
    if (error instanceof NovelPromotionProjectScopeError) {
        throw new ApiError('NOT_FOUND')
    }
    throw error
}

async function deleteSupersededImages(
    imageValues: readonly string[],
    restoredValues: ReadonlySet<string>,
) {
    for (const value of imageValues) {
        if (!value || restoredValues.has(value)) continue
        try {
            const storageKey = await resolveStorageKeyFromMediaValue(value)
            if (storageKey) await deleteCOSObject(storageKey)
        } catch { }
    }
}
