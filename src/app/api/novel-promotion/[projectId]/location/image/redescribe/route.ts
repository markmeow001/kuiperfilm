import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { redescribeAssetFromImage } from '@/lib/novel-promotion/asset-image-redescribe'

/**
 * POST /api/novel-promotion/[projectId]/location/image/redescribe
 *
 * Manual rewrite for LocationImage.description from its current image.
 * Body: { locationImageId: string }
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json().catch(() => ({}))
    const locationImageId = typeof body?.locationImageId === 'string' ? body.locationImageId : ''
    if (!locationImageId) throw new ApiError('INVALID_PARAMS')

    const locationImage = await prisma.locationImage.findUnique({
        where: { id: locationImageId },
        include: {
            location: { include: { novelPromotionProject: { select: { projectId: true } } } },
        },
    })
    if (!locationImage) throw new ApiError('NOT_FOUND')
    if (locationImage.location.novelPromotionProject.projectId !== projectId) {
        throw new ApiError('INVALID_PARAMS')
    }
    if (!locationImage.imageUrl) {
        return NextResponse.json(
            { success: false, error: 'NO_IMAGE_TO_DESCRIBE' },
            { status: 409 },
        )
    }

    const result = await redescribeAssetFromImage({
        kind: 'location',
        imageKeyOrUrl: locationImage.imageUrl,
        projectId,
        userId: authResult.session.user.id,
        entityId: locationImage.id,
    })
    if (!result.ok) {
        const status = result.code === 'ANALYSIS_MODEL_NOT_CONFIGURED' ? 412
            : result.code === 'EMPTY_VISION_RESULT' ? 502
                : 500
        return NextResponse.json({ success: false, error: result.code }, { status })
    }

    await prisma.locationImage.update({
        where: { id: locationImage.id },
        data: {
            previousDescription: locationImage.description ?? null,
            description: result.description,
        },
    })

    return NextResponse.json({ success: true, description: result.description })
})
