import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { redescribeAssetFromImage } from '@/lib/novel-promotion/asset-image-redescribe'

/**
 * POST /api/novel-promotion/[projectId]/character/appearance/redescribe
 *
 * Manual trigger for "rewrite description from current image". The
 * upload endpoint auto-fires this on every new upload; this endpoint
 * is the legacy escape hatch for appearances that were uploaded before
 * the auto-rewrite path landed.
 *
 * Body: { appearanceId: string }
 * Returns: { success, description } on 200, or distinct error codes.
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json().catch(() => ({}))
    const appearanceId = typeof body?.appearanceId === 'string' ? body.appearanceId : ''
    if (!appearanceId) throw new ApiError('INVALID_PARAMS')

    const appearance = await prisma.characterAppearance.findUnique({
        where: { id: appearanceId },
        include: {
            character: { include: { novelPromotionProject: { select: { projectId: true } } } },
        },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    if (appearance.character.novelPromotionProject.projectId !== projectId) {
        throw new ApiError('INVALID_PARAMS')
    }

    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
    const selectedIndex = appearance.selectedIndex
    const candidateKey =
        (selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null)
        || imageUrls.find((url) => !!url)
        || appearance.imageUrl
        || null
    if (!candidateKey) {
        return NextResponse.json(
            { success: false, error: 'NO_IMAGE_TO_DESCRIBE' },
            { status: 409 },
        )
    }

    const result = await redescribeAssetFromImage({
        kind: 'character',
        imageKeyOrUrl: candidateKey,
        projectId,
        userId: authResult.session.user.id,
        entityId: appearance.id,
    })
    if (!result.ok) {
        const status = result.code === 'ANALYSIS_MODEL_NOT_CONFIGURED' ? 412
            : result.code === 'EMPTY_VISION_RESULT' ? 502
                : 500
        return NextResponse.json({ success: false, error: result.code }, { status })
    }

    await prisma.characterAppearance.update({
        where: { id: appearance.id },
        data: {
            previousDescription: appearance.description ?? null,
            description: result.description,
        },
    })

    return NextResponse.json({ success: true, description: result.description })
})
