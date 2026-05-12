import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeAiVisionStep } from '@/lib/ai-runtime'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { getProjectModelConfig } from '@/lib/config-service'
import { createScopedLogger } from '@/lib/logging/core'

/**
 * POST /api/novel-promotion/[projectId]/character/appearance/redescribe
 *
 * Manual trigger for "rewrite description from current image". The
 * upload endpoint auto-fires this on every new upload, but for legacy
 * appearances (uploaded before the auto-rewrite path landed) the user
 * needs a way to fix the description without re-uploading the same file.
 *
 * Body: { appearanceId: string }
 *
 * Returns: { description: string } — new description text, or 409 if
 *          the appearance has no image yet.
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
    if (!appearanceId) {
        throw new ApiError('INVALID_PARAMS')
    }

    const appearance = await prisma.characterAppearance.findUnique({
        where: { id: appearanceId },
        include: {
            character: { include: { novelPromotionProject: { select: { projectId: true } } } },
        },
    })
    if (!appearance) {
        throw new ApiError('NOT_FOUND')
    }
    if (appearance.character.novelPromotionProject.projectId !== projectId) {
        throw new ApiError('INVALID_PARAMS')
    }

    // Pick the selected image (or fall back to imageUrls[0] / legacy
    // imageUrl). Mirrors the worker's resolution priority so the
    // description matches the image users actually see.
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

    const logger = createScopedLogger({
        module: 'api.character-appearance-redescribe',
        action: 'character_appearance_describe',
    })

    const signedUrl = candidateKey.startsWith('http')
        ? candidateKey
        : await getSignedUrl(candidateKey, 3600)
    if (!signedUrl) {
        return NextResponse.json(
            { success: false, error: 'IMAGE_URL_RESOLVE_FAILED' },
            { status: 500 },
        )
    }

    const projectModels = await getProjectModelConfig(projectId, authResult.session.user.id)
    const analysisModel = projectModels.analysisModel
    if (!analysisModel) {
        return NextResponse.json(
            { success: false, error: 'ANALYSIS_MODEL_NOT_CONFIGURED' },
            { status: 412 },
        )
    }

    const completion = await executeAiVisionStep({
        userId: authResult.session.user.id,
        model: analysisModel,
        prompt: buildPrompt({
            promptId: PROMPT_IDS.CHARACTER_IMAGE_TO_DESCRIPTION,
            locale: 'zh',
        }),
        imageUrls: [signedUrl],
        temperature: 0.3,
        projectId,
    })
    const newDescription = completion.text?.trim()
    if (!newDescription) {
        return NextResponse.json(
            { success: false, error: 'EMPTY_VISION_RESULT' },
            { status: 502 },
        )
    }

    await prisma.characterAppearance.update({
        where: { id: appearance.id },
        data: {
            previousDescription: appearance.description ?? null,
            description: newDescription,
        },
    })

    logger.info({
        message: 'appearance description rewritten via manual redescribe',
        details: {
            appearanceId: appearance.id,
            model: analysisModel,
            descriptionPreview: newDescription.slice(0, 80),
        },
    })

    return NextResponse.json({
        success: true,
        description: newDescription,
    })
})
