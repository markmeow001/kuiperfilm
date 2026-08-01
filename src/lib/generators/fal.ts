import { createScopedLogger, logError as _ulogError } from '@/lib/logging/core'
/**
 * FAL 生成器（统一图像 + 视频）
 *
 * 图像模型：
 * - Banana Pro (2K/4K) - fal-ai/nano-banana-pro       (modelId: 'banana')
 * - Banana 2  (1K/2K/4K) - fal-ai/nano-banana-2       (modelId: 'banana-2')
 *
 * 视频模型：
 * - Wan 2.6 (fal-wan25) - wan/v2.6/image-to-video
 * - Veo 3.1 (fal-veo31) - fal-ai/veo3.1/fast/image-to-video
 * - Sora 2 (fal-sora2) - fal-ai/sora-2/image-to-video
 * - Kling 2.5 Turbo Pro - fal-ai/kling-video/v2.5-turbo/pro/image-to-video
 * - Kling 3 Standard - fal-ai/kling-video/v3/standard/image-to-video
 * - Kling 3 Pro - fal-ai/kling-video/v3/pro/image-to-video
 * - Seedance 2.0 i2v - bytedance/seedance-2.0/image-to-video (audio + 1080p,2026-05-16 加入作为 BobAPI 备援)
 * - Seedance 2.0 Fast i2v - bytedance/seedance-2.0/fast/image-to-video
 */

import {
    BaseImageGenerator,
    BaseVideoGenerator,
    ImageGenerateParams,
    VideoGenerateParams,
    GenerateResult
} from './base'
import { getProviderConfig } from '@/lib/api-config'
import { submitFalTask } from '@/lib/async-submit'
import { imageUrlToBase64 } from '@/lib/cos'

// ============================================================
// 图像模型端点映射（modelId → FAL 端点前缀）
// ============================================================

const FAL_IMAGE_ENDPOINTS: Record<string, { base: string; edit: string }> = {
    'banana': { base: 'fal-ai/nano-banana-pro', edit: 'fal-ai/nano-banana-pro/edit' },
    'banana-2': { base: 'fal-ai/nano-banana-2', edit: 'fal-ai/nano-banana-2/edit' },
}

// ============================================================
// 视频模型端点映射
// ============================================================

const FAL_VIDEO_ENDPOINTS: Record<string, string> = {
    'fal-wan25': 'wan/v2.6/image-to-video',
    'fal-veo31': 'fal-ai/veo3.1/fast/image-to-video',
    'fal-sora2': 'fal-ai/sora-2/image-to-video',
    'fal-ai/kling-video/v2.5-turbo/pro/image-to-video': 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    'fal-ai/kling-video/v3/standard/image-to-video': 'fal-ai/kling-video/v3/standard/image-to-video',
    'fal-ai/kling-video/v3/pro/image-to-video': 'fal-ai/kling-video/v3/pro/image-to-video',
    // Seedance 2.0 on fal (2026-04-15 enterprise launch). image_url + optional
    // end_image_url for first/last frame mode; native generate_audio.
    'bytedance/seedance-2.0/image-to-video': 'bytedance/seedance-2.0/image-to-video',
    'bytedance/seedance-2.0/fast/image-to-video': 'bytedance/seedance-2.0/fast/image-to-video',
    // Seedance 2.0 reference-to-video on fal (2026-05-21 Phase D). Multi-ref
    // composite: image_urls[] up to 9, video_urls[] up to 3, audio_urls[] up
    // to 3. Prompt references refs via @Image1 / @Video1 / @Audio1 tags
    // (different convention from AtlasCloud's "image 1" / "video 1").
    'bytedance/seedance-2.0/reference-to-video': 'bytedance/seedance-2.0/reference-to-video',
    'bytedance/seedance-2.0/fast/reference-to-video': 'bytedance/seedance-2.0/fast/reference-to-video',
}

// ============================================================
// FAL 图像生成器 (Banana Pro / Banana 2)
// ============================================================

export class FalImageGenerator extends BaseImageGenerator {
    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'fal')
        const {
            aspectRatio,
            resolution,
            outputFormat = 'png',
            modelId: optModelId = 'banana'
        } = options as {
            aspectRatio?: string
            resolution?: string
            outputFormat?: string
            provider?: string
            modelId?: string
            modelKey?: string
        }

        const allowedOptionKeys = new Set([
            'provider',
            'modelId',
            'modelKey',
            'aspectRatio',
            'resolution',
            'outputFormat',
        ])
        for (const [key, value] of Object.entries(options)) {
            if (value === undefined) continue
            if (!allowedOptionKeys.has(key)) {
                throw new Error(`FAL_IMAGE_OPTION_UNSUPPORTED: ${key}`)
            }
        }
        if (resolution !== undefined && resolution !== '1K' && resolution !== '2K' && resolution !== '4K') {
            throw new Error(`FAL_IMAGE_OPTION_VALUE_UNSUPPORTED: resolution=${resolution}`)
        }

        // 根据 modelId 和是否有参考图片选择端点
        const hasReferenceImages = referenceImages.length > 0
        if (referenceImages.length > 14) {
            throw new Error(`FAL_IMAGE_REFERENCE_LIMIT_EXCEEDED: ${referenceImages.length} > 14`)
        }
        const endpointConfig = FAL_IMAGE_ENDPOINTS[optModelId] || FAL_IMAGE_ENDPOINTS['banana']
        const endpoint = hasReferenceImages ? endpointConfig.edit : endpointConfig.base

        const logger = createScopedLogger({
            module: 'worker.fal-image',
            action: 'fal_image_generate',
        })
        logger.info({
            message: 'FAL image generation request',
            details: {
                modelId: optModelId,
                endpoint,
                referenceImagesCount: referenceImages.length,
                hasReferenceImages,
                resolution: resolution ?? null,
                aspectRatio: aspectRatio ?? null,
                referenceImageUrls: referenceImages.map((u: string) => u.substring(0, 100)),
            },
        })

        const body: Record<string, unknown> = {
            prompt,
            num_images: 1,
            output_format: outputFormat
        }
        if (aspectRatio) {
            body.aspect_ratio = aspectRatio
        }
        if (resolution) {
            body.resolution = resolution
        }

        if (hasReferenceImages) {
            // 🔥 转换参考图片为Data URL（适配内网/本地环境）
            const dataUrls = await Promise.all(
                referenceImages.map(async (url: string) => {
                    // 如果已经是data URL，直接返回
                    if (url.startsWith('data:')) return url
                    // 否则转换为Data URL
                    return await imageUrlToBase64(url)
                })
            )
            body.image_urls = dataUrls
            logger.info({
                message: 'FAL image reference images converted',
                details: {
                    count: referenceImages.length,
                    sizes: dataUrls.map((d: string) => `${Math.round(d.length / 1024)}KB`),
                },
            })
        }

        logger.info({
            message: 'FAL image request body summary',
            details: {
                url: `https://queue.fal.run/${endpoint}`,
                promptLength: prompt.length,
                imageUrlsCount: hasReferenceImages ? (body.image_urls as string[]).length : 0,
                resolution: body.resolution ?? null,
                aspectRatio: body.aspect_ratio ?? null,
                outputFormat: body.output_format,
            },
        })

        // 提交异步任务
        const submitResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${apiKey}`
            },
            body: JSON.stringify(body),
            cache: 'no-store'
        })

        if (!submitResponse.ok) {
            const errorText = await submitResponse.text()
            throw new Error(`FAL 提交失败 (${submitResponse.status}): ${errorText}`)
        }

        const submitData = await submitResponse.json()
        const requestId = submitData.request_id

        if (!requestId) {
            throw new Error('FAL 未返回 request_id')
        }

        return {
            success: true,
            async: true,
            requestId,        // 向后兼容
            endpoint,         // 向后兼容
            externalId: `FAL:IMAGE:${endpoint}:${requestId}`  // 🔥 标准格式
        }
    }
}

// ============================================================
// FAL 视频生成器 (Wan 2.6, Veo 3.1, Sora 2, Kling)
// ============================================================

export class FalVideoGenerator extends BaseVideoGenerator {
    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt = '', options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'fal')
        const {
            duration,
            resolution,
            aspectRatio,
            modelId = 'fal-wan25',
            lastFrameImageUrl,
            generateAudio,
            seed,
            referenceImages,
            referenceVideos,
            referenceAudios,
        } = options as {
            duration?: number
            resolution?: string
            aspectRatio?: string
            modelId?: string
            provider?: string
            modelKey?: string
            lastFrameImageUrl?: string
            generateAudio?: boolean
            seed?: number
            referenceImages?: string[]
            referenceVideos?: string[]
            referenceAudios?: string[]
        }

        const allowedOptionKeys = new Set([
            'provider',
            'modelId',
            'modelKey',
            'duration',
            'resolution',
            'aspectRatio',
            'lastFrameImageUrl',
            'generateAudio',
            'seed',
            // Phase D (2026-05-21) — Seedance 2.0 reference-to-video.
            'referenceImages',
            'referenceVideos',
            'referenceAudios',
        ])
        for (const [key, value] of Object.entries(options)) {
            if (value === undefined) continue
            if (!allowedOptionKeys.has(key)) {
                throw new Error(`FAL_VIDEO_OPTION_UNSUPPORTED: ${key}`)
            }
        }

        // 获取端点
        const endpoint = FAL_VIDEO_ENDPOINTS[modelId]
        if (!endpoint) {
            throw new Error(`FAL_VIDEO_MODEL_UNSUPPORTED: ${modelId}`)
        }
        const vLogger = createScopedLogger({ module: 'worker.fal-video', action: 'fal_video_generate' })
        vLogger.info({ message: 'FAL video generation request', details: { modelId, endpoint } })

        // 根据模型构建不同的请求体
        let input: Record<string, unknown>

        switch (modelId) {
            case 'fal-wan25':
                input = {
                    image_url: imageUrl,
                    prompt,
                    ...(resolution ? { resolution } : {}),
                    ...(typeof duration === 'number' ? { duration: String(duration) } : {})
                }
                break
            case 'fal-veo31':
                input = {
                    image_url: imageUrl,
                    prompt,
                    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
                    ...(typeof duration === 'number' ? { duration: `${duration}s` } : {}),
                    generate_audio: false
                }
                break
            case 'fal-sora2':
                input = {
                    image_url: imageUrl,
                    prompt,
                    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
                    ...(typeof duration === 'number' ? { duration } : {}),
                    delete_video: false
                }
                break
            case 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video':
                input = {
                    image_url: imageUrl,
                    prompt,
                    ...(typeof duration === 'number' ? { duration: String(duration) } : {}),
                    negative_prompt: 'blur, distort, and low quality',
                    cfg_scale: 0.5
                }
                break
            case 'fal-ai/kling-video/v3/standard/image-to-video':
            case 'fal-ai/kling-video/v3/pro/image-to-video':
                input = {
                    start_image_url: imageUrl,
                    prompt,
                    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
                    ...(typeof duration === 'number' ? { duration: String(duration) } : {}),
                    generate_audio: false,
                }
                break
            case 'bytedance/seedance-2.0/reference-to-video':
            case 'bytedance/seedance-2.0/fast/reference-to-video': {
                // fal Seedance 2.0 reference-to-video spec (fal docs 2026-04-15):
                //   required: prompt
                //   optional: image_urls[] (≤9, max 30MB each, cited as @Image1...@Image9),
                //             video_urls[] (≤3, total ≤15s combined, cited as @Video1...),
                //             audio_urls[] (≤3, total ≤15s combined, cited as @Audio1...),
                //             resolution (480p|720p|1080p, default 720p),
                //             aspect_ratio (auto|21:9|16:9|4:3|1:1|3:4|9:16, default auto),
                //             duration ('auto' or integer 4-15, default auto),
                //             generate_audio (bool, default true),
                //             seed (int)
                // Worker must inject @Image1/@Image2/... tags into the prompt
                // for character / scene anchoring — the model maps tag to
                // the same-indexed image_urls entry. Empty image_urls is
                // allowed (degenerates to t2v from prompt alone).
                const allowedRatios = new Set(['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
                const allowedResolutions = new Set(['480p', '720p', '1080p'])
                const clampedDuration =
                    typeof duration === 'number' && Number.isFinite(duration)
                        ? Math.max(4, Math.min(15, Math.round(duration)))
                        : undefined
                if (referenceImages && referenceImages.length > 9) {
                    throw new Error(
                        `FAL_SEEDANCE_R2V_IMAGE_URLS_OVER_LIMIT: ${referenceImages.length} > 9`,
                    )
                }
                if (referenceVideos && referenceVideos.length > 3) {
                    throw new Error(`FAL_SEEDANCE_R2V_VIDEO_URLS_OVER_LIMIT: ${referenceVideos.length} > 3`)
                }
                if (referenceAudios && referenceAudios.length > 3) {
                    throw new Error(`FAL_SEEDANCE_R2V_AUDIO_URLS_OVER_LIMIT: ${referenceAudios.length} > 3`)
                }
                input = {
                    prompt,
                    ...(referenceImages && referenceImages.length > 0 ? { image_urls: referenceImages } : {}),
                    ...(referenceVideos && referenceVideos.length > 0 ? { video_urls: referenceVideos } : {}),
                    ...(referenceAudios && referenceAudios.length > 0 ? { audio_urls: referenceAudios } : {}),
                    ...(resolution && allowedResolutions.has(resolution) ? { resolution } : {}),
                    ...(aspectRatio && allowedRatios.has(aspectRatio) ? { aspect_ratio: aspectRatio } : {}),
                    ...(clampedDuration !== undefined ? { duration: clampedDuration } : {}),
                    ...(typeof generateAudio === 'boolean' ? { generate_audio: generateAudio } : { generate_audio: true }),
                    ...(typeof seed === 'number' ? { seed } : {}),
                }
                vLogger.info({
                    message: 'FAL Seedance r2v request shape',
                    details: {
                        imageUrlsCount: referenceImages?.length ?? 0,
                        videoUrlsCount: referenceVideos?.length ?? 0,
                        audioUrlsCount: referenceAudios?.length ?? 0,
                        duration: clampedDuration,
                        resolution,
                        aspectRatio,
                    },
                })
                break
            }
            case 'bytedance/seedance-2.0/image-to-video':
            case 'bytedance/seedance-2.0/fast/image-to-video': {
                // fal Seedance 2.0 spec (fal docs 2026-04-15):
                //   required: prompt, image_url
                //   optional: end_image_url, resolution (480p|720p|1080p, default 720p),
                //             aspect_ratio (auto|21:9|16:9|4:3|1:1|3:4|9:16, default auto),
                //             duration ('auto' or integer 4-15, default auto),
                //             generate_audio (bool, default true),
                //             seed (int)
                const allowedRatios = new Set(['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
                const allowedResolutions = new Set(['480p', '720p', '1080p'])
                const clampedDuration =
                    typeof duration === 'number' && Number.isFinite(duration)
                        ? Math.max(4, Math.min(15, Math.round(duration)))
                        : undefined
                input = {
                    image_url: imageUrl,
                    prompt,
                    ...(lastFrameImageUrl ? { end_image_url: lastFrameImageUrl } : {}),
                    ...(resolution && allowedResolutions.has(resolution) ? { resolution } : {}),
                    ...(aspectRatio && allowedRatios.has(aspectRatio) ? { aspect_ratio: aspectRatio } : {}),
                    ...(clampedDuration !== undefined ? { duration: clampedDuration } : {}),
                    // generate_audio defaults to true on fal; respect explicit caller intent
                    // (worker passes false by default to match silent-storyboard convention).
                    ...(typeof generateAudio === 'boolean' ? { generate_audio: generateAudio } : { generate_audio: false }),
                    ...(typeof seed === 'number' ? { seed } : {}),
                }
                break
            }
            default:
                throw new Error(`FAL_VIDEO_MODEL_UNSUPPORTED: ${modelId}`)
        }

        try {
            const requestId = await submitFalTask(endpoint, input, apiKey)
            vLogger.info({ message: 'FAL video task submitted', details: { requestId } })

            return {
                success: true,
                async: true,
                requestId,  // 向后兼容
                endpoint,   // 向后兼容  
                externalId: `FAL:VIDEO:${endpoint}:${requestId}`  // 🔥 标准格式
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : '未知错误'
            _ulogError(`[FAL Video] 提交失败:`, message)
            throw new Error(`FAL 视频任务提交失败: ${message}`)
        }
    }
}

// ============================================================
// 向后兼容别名
// ============================================================

export const FalBananaGenerator = FalImageGenerator
