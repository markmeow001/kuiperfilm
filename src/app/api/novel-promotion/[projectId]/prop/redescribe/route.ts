import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { redescribeAssetFromImage } from '@/lib/novel-promotion/asset-image-redescribe'

/**
 * POST /api/novel-promotion/[projectId]/prop/redescribe
 *
 * Manual rewrite for NovelPromotionProp.description from its current image.
 * Body: { propId: string }
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json().catch(() => ({}))
    const propId = typeof body?.propId === 'string' ? body.propId : ''
    if (!propId) throw new ApiError('INVALID_PARAMS')

    const prop = await prisma.novelPromotionProp.findUnique({
        where: { id: propId },
        include: { novelPromotionProject: { select: { projectId: true } } },
    })
    if (!prop) throw new ApiError('NOT_FOUND')
    if (prop.novelPromotionProject.projectId !== projectId) {
        throw new ApiError('INVALID_PARAMS')
    }
    if (!prop.imageUrl) {
        return NextResponse.json(
            { success: false, error: 'NO_IMAGE_TO_DESCRIBE' },
            { status: 409 },
        )
    }

    const result = await redescribeAssetFromImage({
        kind: 'prop',
        imageKeyOrUrl: prop.imageUrl,
        projectId,
        userId: authResult.session.user.id,
        entityId: prop.id,
    })
    if (!result.ok) {
        const status = result.code === 'ANALYSIS_MODEL_NOT_CONFIGURED' ? 412
            : result.code === 'EMPTY_VISION_RESULT' ? 502
                : 500
        return NextResponse.json({ success: false, error: result.code }, { status })
    }

    await prisma.novelPromotionProp.update({
        where: { id: prop.id },
        data: { description: result.description },
    })

    return NextResponse.json({ success: true, description: result.description })
})
