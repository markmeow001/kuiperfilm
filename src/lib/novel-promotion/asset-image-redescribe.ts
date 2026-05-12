/**
 * Shared helper that re-extracts an asset description from its current
 * image using the project's analysis model + a vision-aware prompt.
 *
 * Used by:
 *   - `/api/novel-promotion/[projectId]/upload-asset-image` (auto-fires
 *     on every upload to keep description in sync with the new image)
 *   - `/api/novel-promotion/[projectId]/character/appearance/redescribe`
 *     (manual button for legacy uploads)
 *   - the location + prop redescribe endpoints (same pattern)
 *
 * Centralised so the four code paths share one prompt-ID mapping and
 * one error-handling story. Caller owns the DB write — this function
 * just produces the new description text.
 */
import { executeAiVisionStep } from '@/lib/ai-runtime'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { getProjectModelConfig } from '@/lib/config-service'
import { getSignedUrl } from '@/lib/cos'
import { createScopedLogger } from '@/lib/logging/core'

export type AssetKind = 'character' | 'location' | 'prop'

const PROMPT_ID_BY_KIND = {
    character: PROMPT_IDS.CHARACTER_IMAGE_TO_DESCRIPTION,
    location: PROMPT_IDS.LOCATION_IMAGE_TO_DESCRIPTION,
    prop: PROMPT_IDS.PROP_IMAGE_TO_DESCRIPTION,
} as const

export interface RedescribeFromImageParams {
    kind: AssetKind
    /** COS key OR fully-qualified https URL — the helper signs COS keys for 1h. */
    imageKeyOrUrl: string
    projectId: string
    userId: string
    /** For log context only — entity id (appearanceId / locationImageId / propId). */
    entityId: string
}

export interface RedescribeFromImageResult {
    ok: true
    description: string
    model: string
}

export interface RedescribeFromImageFailure {
    ok: false
    /** Distinct codes the caller can map to user-facing messages or HTTP statuses. */
    code: 'IMAGE_URL_RESOLVE_FAILED' | 'ANALYSIS_MODEL_NOT_CONFIGURED' | 'EMPTY_VISION_RESULT' | 'VISION_CALL_FAILED'
    message: string
}

export async function redescribeAssetFromImage(
    params: RedescribeFromImageParams,
): Promise<RedescribeFromImageResult | RedescribeFromImageFailure> {
    const logger = createScopedLogger({
        module: 'novel-promotion.asset-image-redescribe',
        action: 'asset_image_redescribe',
    })

    let signedUrl: string | null = null
    try {
        signedUrl = params.imageKeyOrUrl.startsWith('http')
            ? params.imageKeyOrUrl
            : getSignedUrl(params.imageKeyOrUrl, 3600)
    } catch {
        signedUrl = null
    }
    if (!signedUrl) {
        return {
            ok: false,
            code: 'IMAGE_URL_RESOLVE_FAILED',
            message: `failed to resolve image url for ${params.entityId}`,
        }
    }

    const projectModels = await getProjectModelConfig(params.projectId, params.userId)
    const analysisModel = projectModels.analysisModel
    if (!analysisModel) {
        return {
            ok: false,
            code: 'ANALYSIS_MODEL_NOT_CONFIGURED',
            message: 'project has no analysisModel configured',
        }
    }

    try {
        const completion = await executeAiVisionStep({
            userId: params.userId,
            model: analysisModel,
            prompt: buildPrompt({
                promptId: PROMPT_ID_BY_KIND[params.kind],
                locale: 'zh',
            }),
            imageUrls: [signedUrl],
            temperature: 0.3,
            projectId: params.projectId,
        })
        const description = completion.text?.trim()
        if (!description) {
            return {
                ok: false,
                code: 'EMPTY_VISION_RESULT',
                message: 'vision model returned empty text',
            }
        }
        logger.info({
            message: 'asset description rewritten from image',
            details: {
                kind: params.kind,
                entityId: params.entityId,
                model: analysisModel,
                descriptionPreview: description.slice(0, 80),
            },
        })
        return { ok: true, description, model: analysisModel }
    } catch (err) {
        return {
            ok: false,
            code: 'VISION_CALL_FAILED',
            message: err instanceof Error ? err.message : String(err),
        }
    }
}
