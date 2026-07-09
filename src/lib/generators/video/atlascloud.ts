/**
 * AtlasCloud 视频生成器
 *
 * Body shape is **FLAT** (top-level keys, no `input:{}` wrapper). Verified
 * 2026-05-20 from the official OpenAPI schema at:
 *   https://static.atlascloud.ai/model/schema/<provider>-<model>-<endpoint>.json
 *
 * Schema differs by model generation:
 *   - v1.5-pro / wan-2.6 (legacy line):
 *       model, image, last_image, prompt, duration, resolution, aspect_ratio,
 *       camera_fixed, seed, generate_audio
 *   - seedance-2.0 (any variant):
 *       model, [image, last_image,] prompt, duration, resolution, **ratio**
 *       (not aspect_ratio), generate_audio, watermark, return_last_frame
 *       — and NO camera_fixed, NO seed
 *
 * Picking the wrong field name silently no-ops (the gateway drops unknown
 * fields without warning), so the generator dispatches per slug family.
 *
 * Bound model slugs:
 *   - seedance-v1.5-pro       → bytedance/seedance-v1.5-pro/image-to-video-fast
 *   - wan-2.6                 → alibaba/wan-2.6/image-to-video-flash
 *   - seedance-2.0-t2v        → bytedance/seedance-2.0/text-to-video
 *   - seedance-2.0-i2v        → bytedance/seedance-2.0/image-to-video
 *   - seedance-2.0-fast-t2v   → bytedance/seedance-2.0-fast/text-to-video
 *   - seedance-2.0-fast-i2v   → bytedance/seedance-2.0-fast/image-to-video
 *   - seedance-2.0-r2v        → bytedance/seedance-2.0/reference-to-video
 *   - seedance-2.0-fast-r2v   → bytedance/seedance-2.0-fast/reference-to-video
 *
 * r2v takes `reference_images[]` (1-9 URLs), optionally `reference_videos[]`
 * (1-3, total ≤15s), and `reference_audios[]` (1-3, requires ≥1 image/video).
 * Prompt references work by ORDER as "image 1", "video 1" text (NOT @Image1
 * tags like fal.ai).
 *
 * API:
 * - 提交: POST https://api.atlascloud.ai/api/v1/model/generateVideo
 *         body.model 帶入上方 slug
 * - 轮询: GET  https://api.atlascloud.ai/api/v1/model/prediction/{requestId}
 *
 * status: created | processing | completed | failed | timeout
 */

import { BaseVideoGenerator, type VideoGenerateParams, type GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { createScopedLogger } from '@/lib/logging/core'

const ATLASCLOUD_BASE_URL = 'https://api.atlascloud.ai/api/v1'

interface AtlasCloudOptions {
    modelId?: string
    duration?: number
    aspectRatio?: string
    generateAudio?: boolean
    cameraFixed?: boolean
    resolution?: string
    seed?: number
    lastFrameImageUrl?: string
    watermark?: boolean
    returnLastFrame?: boolean
    /** r2v only — reference image URLs (1-9). Falls back to imageUrl if empty. */
    referenceImages?: string[]
    /** r2v only — reference video URLs (1-3, total ≤15s). */
    referenceVideos?: string[]
    /** r2v only — reference audio URLs (1-3, requires ≥1 image/video). */
    referenceAudios?: string[]
}

const ATLASCLOUD_MODEL_MAP: Record<string, string> = {
    'seedance-v1.5-pro': 'bytedance/seedance-v1.5-pro/image-to-video-fast',
    'wan-2.6': 'alibaba/wan-2.6/image-to-video-flash',
    'seedance-2.0-t2v': 'bytedance/seedance-2.0/text-to-video',
    'seedance-2.0-i2v': 'bytedance/seedance-2.0/image-to-video',
    'seedance-2.0-fast-t2v': 'bytedance/seedance-2.0-fast/text-to-video',
    'seedance-2.0-fast-i2v': 'bytedance/seedance-2.0-fast/image-to-video',
    'seedance-2.0-r2v': 'bytedance/seedance-2.0/reference-to-video',
    'seedance-2.0-fast-r2v': 'bytedance/seedance-2.0-fast/reference-to-video',
}

function isSeedance2Slug(slug: string): boolean {
    return slug.startsWith('bytedance/seedance-2.0')
}

function isTextToVideoSlug(slug: string): boolean {
    return slug.endsWith('/text-to-video')
}

function isReferenceToVideoSlug(slug: string): boolean {
    return slug.endsWith('/reference-to-video')
}

function resolveAtlasCloudModel(modelId?: string): string {
    if (modelId && ATLASCLOUD_MODEL_MAP[modelId]) return ATLASCLOUD_MODEL_MAP[modelId]
    return ATLASCLOUD_MODEL_MAP['seedance-v1.5-pro']
}

export class AtlasCloudSeedanceVideoGenerator extends BaseVideoGenerator {
    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt: paramPrompt = '', options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'atlascloud')

        const {
            modelId,
            duration = 5,
            aspectRatio = '16:9',
            generateAudio = true,
            cameraFixed = false,
            resolution = '720p',
            seed = -1,
            lastFrameImageUrl,
            watermark = false,
            returnLastFrame = false,
            referenceImages,
            referenceVideos,
            referenceAudios,
        } = options as AtlasCloudOptions

        const atlasModel = resolveAtlasCloudModel(modelId)
        const isV2 = isSeedance2Slug(atlasModel)
        const t2vMode = isTextToVideoSlug(atlasModel)
        const r2vMode = isReferenceToVideoSlug(atlasModel)

        const logger = createScopedLogger({
            module: 'worker.atlascloud-video',
            action: 'atlascloud_video_generate',
        })

        // FLAT body — top-level keys, no `input:{}` wrapper.
        const body: Record<string, unknown> = {
            model: atlasModel,
            duration,
            resolution,
            generate_audio: generateAudio,
        }

        // Seedance 2.0 vs legacy schema split
        if (isV2) {
            // Seedance 2.0: `ratio` (not `aspect_ratio`), + watermark + return_last_frame,
            // no camera_fixed, no seed
            body.ratio = aspectRatio
            body.watermark = watermark
            body.return_last_frame = returnLastFrame
        } else {
            // Legacy v1.5-pro / wan-2.6: `aspect_ratio`, `camera_fixed`, `seed`
            body.aspect_ratio = aspectRatio
            body.camera_fixed = cameraFixed
            body.seed = seed
        }

        // Mode-specific media inputs
        if (r2vMode) {
            // reference-to-video: optional reference_images (1-9), optional
            // reference_videos (1-3), optional reference_audios (1-3).
            // Per the OpenAPI schema only `model` is strictly required — a
            // pure motion-reference call (reference_videos, no images) is
            // valid. We previously hard-required ≥1 image, which rejected the
            // Playground「參考影片生成」flow (0 images + 1 video) with an
            // opaque error the client scrubbed into "系统内部错误". Only
            // enforce the real constraint: at least one VISUAL reference
            // (image or video); reference_audios alone is not valid.
            // (2026-07-09 playground r2v video-only fix)
            const refImages = referenceImages?.length
                ? referenceImages
                : (imageUrl ? [imageUrl] : [])
            if (refImages.length > 9) {
                throw new Error(
                    `AtlasCloud ${atlasModel} reference_images 最多 9 張，收到 ${refImages.length}`,
                )
            }
            if (referenceVideos && referenceVideos.length > 3) {
                throw new Error(`AtlasCloud reference_videos 最多 3 個`)
            }
            if (referenceAudios && referenceAudios.length > 3) {
                throw new Error(`AtlasCloud reference_audios 最多 3 個`)
            }
            if (refImages.length === 0 && !referenceVideos?.length) {
                throw new Error(
                    `AtlasCloud ${atlasModel} (reference-to-video) 需要至少 1 張 reference_images ` +
                    `或 1 支 reference_videos，但兩者都為空`,
                )
            }
            if (refImages.length > 0) {
                body.reference_images = refImages
            }
            if (referenceVideos?.length) {
                body.reference_videos = referenceVideos
            }
            if (referenceAudios?.length) {
                body.reference_audios = referenceAudios
            }
        } else if (!t2vMode) {
            // i2v: required `image`, optional `last_image`
            if (!imageUrl) {
                throw new Error(`AtlasCloud ${atlasModel} (image-to-video) 需要 imageUrl 但為空`)
            }
            body.image = imageUrl
            if (lastFrameImageUrl) {
                body.last_image = lastFrameImageUrl
            }
        }
        // t2v mode: no image / reference fields; prompt is required.

        if (paramPrompt) {
            body.prompt = paramPrompt
        } else if (t2vMode) {
            throw new Error(
                `AtlasCloud ${atlasModel} (text-to-video) 需要 prompt 但為空`,
            )
        }

        logger.info({
            message: 'AtlasCloud Seedance video generation request',
            details: {
                model: atlasModel,
                mode: r2vMode ? 'r2v' : t2vMode ? 't2v' : 'i2v',
                schemaGen: isV2 ? 'v2' : 'legacy',
                duration,
                aspectRatio,
                generateAudio,
                hasImage: !t2vMode && !!imageUrl,
                hasPrompt: !!paramPrompt,
                hasLastFrame: !t2vMode && !r2vMode && !!lastFrameImageUrl,
                refImagesCount: r2vMode ? (body.reference_images as string[] | undefined)?.length ?? 0 : undefined,
                refVideosCount: r2vMode ? (body.reference_videos as string[] | undefined)?.length ?? 0 : undefined,
                refAudiosCount: r2vMode ? (body.reference_audios as string[] | undefined)?.length ?? 0 : undefined,
            },
        })

        const response = await fetch(
            `${ATLASCLOUD_BASE_URL}/model/generateVideo`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
            },
        )

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`AtlasCloud Seedance 提交失败 (${response.status}): ${errorText}`)
        }

        // Submit response is flat per schema: { id, urls, model, status, ... }
        // Legacy wrapped shape { code, data:{id} } may still appear from older
        // gateway versions — keep both fallbacks.
        const responseBody = await response.json() as {
            code?: number
            message?: string
            data?: {
                id: string
                model: string
                status: string
                urls?: { get?: string }
            }
            id?: string
            model?: string
            status?: string
        }

        if (responseBody.code !== undefined && responseBody.code !== 200) {
            throw new Error(`AtlasCloud Seedance 错误 (code ${responseBody.code}): ${responseBody.message ?? ''}`)
        }

        const requestId = responseBody.data?.id ?? responseBody.id
        if (!requestId) {
            throw new Error(
                `AtlasCloud Seedance 未返回 prediction ID (response keys: ${Object.keys(responseBody).join(',')})`,
            )
        }

        logger.info({
            message: 'AtlasCloud Seedance task submitted',
            details: { requestId, status: responseBody.data?.status ?? responseBody.status },
        })

        return {
            success: true,
            async: true,
            externalId: `ATLASCLOUD:VIDEO:${requestId}`,
        }
    }
}

/**
 * 查询 AtlasCloud Seedance 任务状态（供 async-poll 调用）
 */
export async function queryAtlasCloudTaskStatus(
    requestId: string,
    apiKey: string,
): Promise<{ status: 'pending' | 'completed' | 'failed'; videoUrl?: string; error?: string }> {
    const response = await fetch(
        `${ATLASCLOUD_BASE_URL}/model/prediction/${encodeURIComponent(requestId)}`,
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
        },
    )

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`AtlasCloud 查询失败 (${response.status}): ${errorText}`)
    }

    const responseBody = await response.json() as {
        code: number
        message: string
        data: {
            id: string
            status: string
            outputs?: string[]
            error?: string
        }
    }

    const data = responseBody.data || responseBody as any

    const logger = createScopedLogger({
        module: 'worker.atlascloud-seedance',
        action: 'atlascloud_seedance_poll',
    })

    logger.info({
        message: 'AtlasCloud Seedance poll response',
        details: {
            requestId,
            status: data.status,
            hasOutputs: !!(data.outputs && data.outputs.length > 0),
        },
    })

    switch (data.status) {
        case 'completed': {
            const videoUrl = data.outputs?.[0]
            if (!videoUrl) {
                return {
                    status: 'failed',
                    error: 'AtlasCloud Seedance: 生成完成但未返回视频URL',
                }
            }
            return {
                status: 'completed',
                videoUrl,
            }
        }
        case 'failed':
        case 'timeout': {
            return {
                status: 'failed',
                error: `AtlasCloud Seedance: 生成失败 — ${data.error || '(无错误信息)'}`,
            }
        }
        case 'created':
        case 'processing':
        default:
            return {
                status: 'pending',
            }
    }
}
