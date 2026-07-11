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
    /**
     * Kling O3 r2v only — named subject bindings (人物/場景). ≤6 subjects,
     * each 1-4 image URLs (first = frontal_image, all = refer_images).
     * The prompt references subjects as <<<element_N>>> (1-based order).
     */
    klingElements?: Array<{ name: string; imageUrls: string[] }>
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
    // 2026-07-10 — Kling Video O3 reference-to-video (named-subject binding
    // + text-to-video). PAID slugs from the model detail page — the schema
    // CDN default carries a "-test" suffix which is AtlasCloud's sandbox
    // deployment, NOT the billable model (Seedance schemas have no such
    // suffix, so it's O3-specific, verified 2026-07-10).
    'kling-o3-std-r2v': 'kwaivgi/kling-video-o3-std/reference-to-video',
    'kling-o3-pro-r2v': 'kwaivgi/kling-video-o3-pro/reference-to-video',
}

function isSeedance2Slug(slug: string): boolean {
    return slug.startsWith('bytedance/seedance-2.0')
}

function isKlingO3Slug(slug: string): boolean {
    return slug.startsWith('kwaivgi/kling-video-o3')
}

/**
 * Kling O3 body builder — schema is DISJOINT from Seedance 2.0:
 * `aspect_ratio` (not `ratio`), `sound` (not `generate_audio`), `images`
 * (not `reference_images`), named `elements`, and NO resolution /
 * watermark / return_last_frame / camera_fixed / seed. Guards mirror the
 * OpenAPI schema limits only (bug-#1 lesson: never guard stricter than
 * the provider).
 */
function buildKlingO3Body(args: {
    atlasModel: string
    prompt: string
    duration: number
    aspectRatio: string
    sound: boolean
    elements?: Array<{ name: string; imageUrls: string[] }>
    images?: string[]
    /** Optional single reference video → schema `video`; caps images at 4. */
    referenceVideos?: string[]
}): Record<string, unknown> {
    const { atlasModel, prompt, duration, aspectRatio, sound, elements, images, referenceVideos } = args

    if (!prompt) {
        throw new Error(`AtlasCloud ${atlasModel} (Kling O3) 需要 prompt 但為空`)
    }
    if (duration < 3 || duration > 15) {
        throw new Error(`AtlasCloud ${atlasModel} duration 需在 3-15 秒，收到 ${duration}`)
    }
    if (!KLING_O3_ASPECT_RATIOS.has(aspectRatio)) {
        // Schema enum is exactly 16:9 / 9:16 / 1:1 — the shared UI offers
        // more (4:3 etc.) which AtlasCloud 400s on. (2026-07-10 review HIGH-2)
        throw new Error(
            `AtlasCloud ${atlasModel} 比例僅支援 16:9 / 9:16 / 1:1，收到 ${aspectRatio}`,
        )
    }
    if (elements && elements.length > 6) {
        throw new Error(`AtlasCloud ${atlasModel} elements 最多 6 個主體，收到 ${elements.length}`)
    }
    for (const el of elements ?? []) {
        if (el.imageUrls.length < 1 || el.imageUrls.length > 4) {
            throw new Error(
                `AtlasCloud ${atlasModel} element「${el.name}」需要 1-4 張參考圖，收到 ${el.imageUrls.length}`,
            )
        }
    }
    if (referenceVideos && referenceVideos.length > 1) {
        throw new Error(`AtlasCloud ${atlasModel} 參考影片最多 1 支，收到 ${referenceVideos.length}`)
    }
    const referenceVideo = referenceVideos?.[0]
    // Schema: images ≤7, or ≤4 when a reference video is supplied.
    const imagesCap = referenceVideo ? 4 : 7
    if (images && images.length > imagesCap) {
        throw new Error(
            `AtlasCloud ${atlasModel} images 最多 ${imagesCap} 張${referenceVideo ? '（有參考影片時）' : ''}，收到 ${images.length}`,
        )
    }

    return {
        model: atlasModel,
        prompt,
        duration,
        aspect_ratio: aspectRatio,
        sound,
        // Reference video rides the schema's `video` field — previously the
        // worker forwarded it but this builder never read it, silently
        // dropping the user's upload. (2026-07-10 review HIGH-1)
        ...(referenceVideo ? { video: referenceVideo } : {}),
        // Schema requires BOTH frontal_image and refer_images for
        // image_refer — refer_images = the full set (frontal included)
        // so a single-image subject still satisfies both fields.
        ...(elements?.length
            ? {
                elements: elements.map((el) => ({
                    element_name: el.name,
                    reference_type: 'image_refer',
                    frontal_image: el.imageUrls[0],
                    refer_images: el.imageUrls,
                })),
            }
            : {}),
        ...(images?.length ? { images } : {}),
    }
}

function isTextToVideoSlug(slug: string): boolean {
    return slug.endsWith('/text-to-video')
}

function isReferenceToVideoSlug(slug: string): boolean {
    return slug.endsWith('/reference-to-video')
}

function resolveAtlasCloudModel(modelId?: string): string {
    if (modelId && ATLASCLOUD_MODEL_MAP[modelId]) return ATLASCLOUD_MODEL_MAP[modelId]
    // 2026-07-10 — a PROVIDED but unknown modelId used to silently fall back
    // to v1.5-pro: a typo generated on the wrong (billable) model with no
    // signal. Explicit failure per CLAUDE.md 不隱式回退. Absent modelId keeps
    // the legacy default for old call sites that predate model routing.
    if (modelId) {
        throw new Error(
            `AtlasCloud 未知 modelId「${modelId}」— 不在 ATLASCLOUD_MODEL_MAP（可用: ${Object.keys(ATLASCLOUD_MODEL_MAP).join(', ')}）`,
        )
    }
    return ATLASCLOUD_MODEL_MAP['seedance-v1.5-pro']
}

const KLING_O3_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1'])

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
            klingElements,
        } = options as AtlasCloudOptions

        const atlasModel = resolveAtlasCloudModel(modelId)
        const klingO3Mode = isKlingO3Slug(atlasModel)
        const isV2 = isSeedance2Slug(atlasModel)
        const t2vMode = isTextToVideoSlug(atlasModel)
        const r2vMode = isReferenceToVideoSlug(atlasModel) && !klingO3Mode

        const logger = createScopedLogger({
            module: 'worker.atlascloud-video',
            action: 'atlascloud_video_generate',
        })

        // FLAT body — top-level keys, no `input:{}` wrapper.
        let body: Record<string, unknown>
        if (klingO3Mode) {
            // Kling O3 r2v — fully disjoint schema; built + guarded in
            // buildKlingO3Body. `sound` defaults ON (2026-07-11): the API
            // schema default is false, but the Kling product ships audible
            // videos by default and users expect it — silent output read as
            // a bug (user report). Explicit generateAudio:false still mutes.
            body = buildKlingO3Body({
                atlasModel,
                prompt: paramPrompt,
                duration,
                aspectRatio,
                sound: (options as AtlasCloudOptions).generateAudio !== false,
                elements: klingElements,
                images: referenceImages?.length
                    ? referenceImages
                    : (imageUrl ? [imageUrl] : undefined),
                referenceVideos,
            })
        } else {
        body = {
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
        } // end non-Kling (Seedance / legacy) body builder

        logger.info({
            message: 'AtlasCloud video generation request',
            details: {
                model: atlasModel,
                mode: klingO3Mode ? 'kling-o3-r2v' : r2vMode ? 'r2v' : t2vMode ? 't2v' : 'i2v',
                schemaGen: klingO3Mode ? 'kling-o3' : isV2 ? 'v2' : 'legacy',
                duration,
                aspectRatio,
                generateAudio,
                hasImage: !t2vMode && !!imageUrl,
                hasPrompt: !!paramPrompt,
                hasLastFrame: !t2vMode && !r2vMode && !!lastFrameImageUrl,
                elementsCount: klingO3Mode ? (body.elements as unknown[] | undefined)?.length ?? 0 : undefined,
                imagesCount: klingO3Mode ? (body.images as string[] | undefined)?.length ?? 0 : undefined,
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
