import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
/**
 * 火山引擎 ARK 生成器（统一图像 + 视频）
 * 
 * 图像模型：
 * - Seedream 4.5 (doubao-seedream-4-5-251128)
 * - Seedream 4.0
 * 
 * 视频模型：
 * - Seedance 1.0 Pro (doubao-seedance-1-0-pro-250528)
 * - Seedance 1.0 Lite (doubao-seedance-1-0-lite-i2v-250428)
 * - Seedance 1.5 Pro (doubao-seedance-1-5-pro-251215)
 * - Seedance 2.0 (doubao-seedance-2-0-260128) — 音畫同生, 4-15s, 480p/720p/1080p
 * - Seedance 2.0 Fast (doubao-seedance-2-0-fast-260128) — 音畫同生, 4-15s, 480p/720p (no 1080p)
 * - 支持批量模式 (-batch 后缀)
 * - 支持首尾帧模式
 * - 支持音频生成 (Seedance 1.5 Pro / 2.0 系列)
 * - 2.0 系列支持多模态 content[]: image_url + video_url + audio_url
 *   參考 https://www.volcengine.com/docs/82379/1520757
 */

import {
    BaseImageGenerator,
    BaseVideoGenerator,
    ImageGenerateParams,
    VideoGenerateParams,
    GenerateResult
} from './base'
import { getProviderConfig } from '@/lib/api-config'
import { arkImageGeneration, arkCreateVideoTask } from '@/lib/ark-api'
import { imageUrlToBase64 } from '@/lib/cos'

interface ArkImageOptions {
    aspectRatio?: string
    modelId?: string
    size?: string
    resolution?: string
    provider?: string
    modelKey?: string
}

interface ArkVideoOptions {
    modelId?: string
    resolution?: string
    duration?: number
    frames?: number
    aspectRatio?: string
    generateAudio?: boolean
    lastFrameImageUrl?: string
    /**
     * 2026-05-22 — Seedance 2.0 系列 multi-modal reference inputs.
     * Each url emits a `{ type: 'image_url', role: 'reference_image' }`
     * content item. Used by multi-shot composite path to anchor character +
     * scene identity across the generated clip. The first image still goes
     * in the top-level `imageUrl` slot as `first_frame` (legacy behavior).
     * Only models with `supportsMultiModalReference=true` accept these;
     * others throw ARK_VIDEO_OPTION_UNSUPPORTED.
     */
    referenceImages?: string[]
    serviceTier?: 'default' | 'flex'
    executionExpiresAfter?: number
    returnLastFrame?: boolean
    draft?: boolean
    seed?: number
    cameraFixed?: boolean
    watermark?: boolean
    provider?: string
    modelKey?: string
}

type ArkVideoContentItem =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string }; role?: 'first_frame' | 'last_frame' | 'reference_image' }

interface ArkSeedanceModelSpec {
    durationMin: number
    durationMax: number
    supportsFirstLastFrame: boolean
    supportsGenerateAudio: boolean
    supportsDraft: boolean
    supportsFrames: boolean
    /** 2026-05-22 — Seedance 2.0 系列「不支持」camera_fixed；1.x 系列支持。
     *  Per docs https://www.volcengine.com/docs/82379/1520757. */
    supportsCameraFixed: boolean
    /** 2026-05-22 — Seedance 2.0 系列只支持 default; 1.x 系列另外支持 flex (离线). */
    supportsFlexTier: boolean
    /** 2026-05-22 — duration=-1 智能选时长. 1.5 pro + 2.0 系列支持. */
    supportsSmartDuration: boolean
    /** 2026-05-22 — multi-modal content[]: video_url / audio_url roles.
     *  仅 Seedance 2.0 系列支持视频 / 音频参考输入. */
    supportsMultiModalReference: boolean
    resolutionOptions: ReadonlyArray<'480p' | '720p' | '1080p'>
}

const ARK_SEEDANCE_MODEL_SPECS: Record<string, ArkSeedanceModelSpec> = {
    'doubao-seedance-1-0-pro-fast-251015': {
        durationMin: 2,
        durationMax: 12,
        supportsFirstLastFrame: false,
        supportsGenerateAudio: false,
        supportsDraft: false,
        supportsFrames: true,
        supportsCameraFixed: true,
        supportsFlexTier: true,
        supportsSmartDuration: false,
        supportsMultiModalReference: false,
        resolutionOptions: ['480p', '720p', '1080p'],
    },
    'doubao-seedance-1-0-pro-250528': {
        durationMin: 2,
        durationMax: 12,
        supportsFirstLastFrame: true,
        supportsGenerateAudio: false,
        supportsDraft: false,
        supportsFrames: true,
        supportsCameraFixed: true,
        supportsFlexTier: true,
        supportsSmartDuration: false,
        supportsMultiModalReference: false,
        resolutionOptions: ['480p', '720p', '1080p'],
    },
    'doubao-seedance-1-0-lite-i2v-250428': {
        durationMin: 2,
        durationMax: 12,
        supportsFirstLastFrame: true,
        supportsGenerateAudio: false,
        supportsDraft: false,
        supportsFrames: true,
        supportsCameraFixed: true,
        supportsFlexTier: true,
        supportsSmartDuration: false,
        supportsMultiModalReference: false,
        resolutionOptions: ['480p', '720p', '1080p'],
    },
    'doubao-seedance-1-5-pro-251215': {
        durationMin: 4,
        durationMax: 12,
        supportsFirstLastFrame: true,
        supportsGenerateAudio: true,
        supportsDraft: true,
        supportsFrames: false,
        supportsCameraFixed: true,
        supportsFlexTier: true,
        supportsSmartDuration: true,
        supportsMultiModalReference: false,
        resolutionOptions: ['480p', '720p', '1080p'],
    },
    // 2026-05-22 — Seedance 2.0 系列 (火山方舟直连). Doubao Seedance 最强模型,
    // 音畫同生 (native dialogue/SFX/BGM via generate_audio=true), 多模态参考输入
    // (image + video + audio), 4-15s, 24fps.
    //
    // 不支持: camera_fixed / frames / draft / service_tier=flex (强校验报错).
    // 帐户余额必须 ≥ 200 元才能开通 (Volcengine 平台限制).
    //
    // Spec ref: https://www.volcengine.com/docs/82379/1520757
    'doubao-seedance-2-0-260128': {
        durationMin: 4,
        durationMax: 15,
        supportsFirstLastFrame: true,
        supportsGenerateAudio: true,
        supportsDraft: false,
        supportsFrames: false,
        supportsCameraFixed: false,
        supportsFlexTier: false,
        supportsSmartDuration: true,
        supportsMultiModalReference: true,
        resolutionOptions: ['480p', '720p', '1080p'],
    },
    'doubao-seedance-2-0-fast-260128': {
        durationMin: 4,
        durationMax: 15,
        supportsFirstLastFrame: true,
        supportsGenerateAudio: true,
        supportsDraft: false,
        supportsFrames: false,
        supportsCameraFixed: false,
        supportsFlexTier: false,
        supportsSmartDuration: true,
        supportsMultiModalReference: true,
        // 2.0 fast 不支持 1080p — per model list at
        // https://www.volcengine.com/docs/82379/1330310#2705b333
        resolutionOptions: ['480p', '720p'],
    },
}

const ARK_VIDEO_ALLOWED_RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])

function isInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value)
}

// ============================================================
// 图像尺寸映射表
// ============================================================

// 4K 分辨率映射表（火山引擎 Seedream 只支持 4K）
const SIZE_MAP_4K: Record<string, string> = {
    '1:1': '4096x4096',
    '16:9': '5456x3072',
    '9:16': '3072x5456',
    '4:3': '4728x3544',
    '3:4': '3544x4728',
    '3:2': '5016x3344',
    '2:3': '3344x5016',
    '21:9': '6256x2680',
    '9:21': '2680x6256',
}

// ============================================================
// ARK 图像生成器 (Seedream)
// ============================================================

export class ArkImageGenerator extends BaseImageGenerator {
    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'ark')
        const {
            aspectRatio,
            modelId = 'doubao-seedream-4-5-251128',
            size: directSize  // 直接传入的像素尺寸（编辑模式）
        } = options as ArkImageOptions

        const allowedOptionKeys = new Set([
            'provider',
            'modelId',
            'modelKey',
            'aspectRatio',
            'size',
            'resolution',
        ])
        for (const [key, value] of Object.entries(options)) {
            if (value === undefined) continue
            if (!allowedOptionKeys.has(key)) {
                throw new Error(`ARK_IMAGE_OPTION_UNSUPPORTED: ${key}`)
            }
        }

        const resolution = (options as ArkImageOptions).resolution
        if (resolution !== undefined && resolution !== '4K') {
            throw new Error(`ARK_IMAGE_OPTION_VALUE_UNSUPPORTED: resolution=${resolution}`)
        }

        // 决定最终 size
        let size: string | undefined
        if (directSize) {
            size = directSize
        } else {
            if (!aspectRatio) {
                throw new Error('ARK_IMAGE_OPTION_REQUIRED: aspectRatio or size must be provided')
            }
            size = SIZE_MAP_4K[aspectRatio]
            if (!size) {
                throw new Error(`ARK_IMAGE_OPTION_VALUE_UNSUPPORTED: aspectRatio=${aspectRatio}`)
            }
        }

        _ulogInfo(`[ARK Image] 模型=${modelId}, aspectRatio=${aspectRatio || '(none)'}, size=${size || '(未传)'}`)

        // 转换参考图片为 Base64
        const base64Images: string[] = []
        for (const imageUrl of referenceImages) {
            try {
                const base64 = await imageUrlToBase64(imageUrl)
                base64Images.push(base64)
            } catch {
                _ulogInfo(`[ARK Image] 参考图片转换失败: ${imageUrl}`)
            }
        }

        // 构建请求体
        const requestBody: {
            model: string
            prompt: string
            sequential_image_generation: 'disabled'
            response_format: 'url'
            stream: false
            watermark: false
            size?: string
            image?: string[]
        } = {
            model: modelId,
            prompt: prompt,
            sequential_image_generation: 'disabled',
            response_format: 'url',
            stream: false,
            watermark: false
        }

        if (size) {
            requestBody.size = size
        }

        if (base64Images.length > 0) {
            requestBody.image = base64Images
        }

        // 调用 ARK API
        const arkData = await arkImageGeneration(requestBody, {
            apiKey,
            logPrefix: '[ARK Image]'
        })

        const imageUrl = arkData.data?.[0]?.url

        if (!imageUrl) {
            throw new Error('ARK 未返回图片 URL')
        }

        return {
            success: true,
            imageUrl
        }
    }
}

// ============================================================
// ARK 视频生成器 (Seedance)
// ============================================================

export class ArkVideoGenerator extends BaseVideoGenerator {
    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt = '', options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'ark')
        const {
            modelId = 'doubao-seedance-1-0-pro-fast-251015',
            resolution,
            duration,
            frames,
            aspectRatio,
            generateAudio,
            lastFrameImageUrl,  // 首尾帧模式的尾帧图片
            serviceTier,
            executionExpiresAfter,
            returnLastFrame,
            draft,
            seed,
            cameraFixed,
            watermark,
            referenceImages,
        } = options as ArkVideoOptions

        const allowedOptionKeys = new Set([
            'provider',
            'modelId',
            'modelKey',
            'resolution',
            'duration',
            'frames',
            'aspectRatio',
            'generateAudio',
            'lastFrameImageUrl',
            'referenceImages',
            'serviceTier',
            'executionExpiresAfter',
            'returnLastFrame',
            'draft',
            'seed',
            'cameraFixed',
            'watermark',
        ])
        for (const [key, value] of Object.entries(options)) {
            if (value === undefined) continue
            if (!allowedOptionKeys.has(key)) {
                throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: ${key}`)
            }
        }

        // 解析批量模式
        const isBatchMode = modelId.endsWith('-batch')
        const realModel = isBatchMode ? modelId.replace('-batch', '') : modelId
        const modelSpec = ARK_SEEDANCE_MODEL_SPECS[realModel]
        if (!modelSpec) {
            throw new Error(`ARK_VIDEO_MODEL_UNSUPPORTED: ${realModel}`)
        }
        // 2026-05-22 — batch mode forces service_tier=flex; 2.0 系列不支持 flex.
        // Fail fast so we don't ship a request the API will 400 on.
        if (isBatchMode && !modelSpec.supportsFlexTier) {
            throw new Error(`ARK_VIDEO_MODEL_UNSUPPORTED: -batch mode for ${realModel} (model does not support flex tier)`)
        }

        if (resolution !== undefined && !modelSpec.resolutionOptions.includes(resolution as '480p' | '720p' | '1080p')) {
            throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: resolution=${resolution}`)
        }
        if (duration !== undefined) {
            if (!isInteger(duration)) {
                throw new Error('ARK_VIDEO_OPTION_INVALID: duration must be integer')
            }
            const durationOutOfRange = duration !== -1 && (duration < modelSpec.durationMin || duration > modelSpec.durationMax)
            if (durationOutOfRange) {
                throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: duration=${duration}`)
            }
            if (duration === -1 && !modelSpec.supportsSmartDuration) {
                throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: duration=-1 not supported by ${realModel}`)
            }
        }
        if (frames !== undefined) {
            if (!modelSpec.supportsFrames) {
                throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: frames for ${realModel}`)
            }
            if (!isInteger(frames)) {
                throw new Error('ARK_VIDEO_OPTION_INVALID: frames must be integer')
            }
            if (frames < 29 || frames > 289 || (frames - 25) % 4 !== 0) {
                throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: frames=${frames}`)
            }
        }
        if (aspectRatio !== undefined && !ARK_VIDEO_ALLOWED_RATIOS.has(aspectRatio)) {
            throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: aspectRatio=${aspectRatio}`)
        }
        if (lastFrameImageUrl && !modelSpec.supportsFirstLastFrame) {
            throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: lastFrameImageUrl for ${realModel}`)
        }
        if (generateAudio !== undefined && !modelSpec.supportsGenerateAudio) {
            throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: generateAudio for ${realModel}`)
        }
        if (serviceTier !== undefined) {
            if (serviceTier !== 'default' && serviceTier !== 'flex') {
                throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: serviceTier=${serviceTier}`)
            }
            if (serviceTier === 'flex' && !modelSpec.supportsFlexTier) {
                throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: flex tier for ${realModel}`)
            }
        }
        if (cameraFixed !== undefined && !modelSpec.supportsCameraFixed) {
            throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: cameraFixed for ${realModel}`)
        }
        if (referenceImages !== undefined) {
            if (!Array.isArray(referenceImages)) {
                throw new Error('ARK_VIDEO_OPTION_INVALID: referenceImages must be array of URLs')
            }
            if (referenceImages.length > 0 && !modelSpec.supportsMultiModalReference) {
                throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: referenceImages for ${realModel}`)
            }
        }
        if (executionExpiresAfter !== undefined) {
            if (!isInteger(executionExpiresAfter)) {
                throw new Error('ARK_VIDEO_OPTION_INVALID: executionExpiresAfter must be integer')
            }
            if (executionExpiresAfter < 3600 || executionExpiresAfter > 259200) {
                throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: executionExpiresAfter=${executionExpiresAfter}`)
            }
        }
        if (seed !== undefined) {
            if (!isInteger(seed)) {
                throw new Error('ARK_VIDEO_OPTION_INVALID: seed must be integer')
            }
            if (seed < -1 || seed > 4294967295) {
                throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: seed=${seed}`)
            }
        }
        if (draft === true) {
            if (!modelSpec.supportsDraft) {
                throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: draft for ${realModel}`)
            }
            if (resolution !== undefined && resolution !== '480p') {
                throw new Error('ARK_VIDEO_OPTION_INVALID: draft only supports 480p')
            }
            if (returnLastFrame === true) {
                throw new Error('ARK_VIDEO_OPTION_INVALID: returnLastFrame is not supported when draft=true')
            }
            if (isBatchMode || serviceTier === 'flex') {
                throw new Error('ARK_VIDEO_OPTION_INVALID: draft does not support flex service tier')
            }
        }

        _ulogInfo(`[ARK Video] 模型: ${realModel}, 批量: ${isBatchMode}, 分辨率: ${resolution || '(默认)'}, 时长: ${duration ?? '(默认)'}`)

        // 构建请求体 content
        const content: ArkVideoContentItem[] = []
        if (prompt.trim()) {
            content.push({ type: 'text', text: prompt })
        }

        // 2026-05-22 — multi-shot composite path passes referenceImages and
        // sometimes leaves imageUrl empty (pure t2v with refs). The base
        // generator types imageUrl as a required string, but the worker
        // contract treats '' as "no first_frame" — match that here.
        const hasFirstFrame = typeof imageUrl === 'string' && imageUrl.trim().length > 0
        const imageBase64 = hasFirstFrame ? await imageUrlToBase64(imageUrl) : null

        if (lastFrameImageUrl) {
            if (!hasFirstFrame || !imageBase64) {
                throw new Error('ARK_VIDEO_OPTION_INVALID: lastFrameImageUrl requires a non-empty imageUrl (first_frame)')
            }
            // 首尾帧模式
            const lastImageBase64 = await imageUrlToBase64(lastFrameImageUrl)
            content.push({
                type: 'image_url',
                image_url: { url: imageBase64 },
                role: 'first_frame'
            })
            content.push({
                type: 'image_url',
                image_url: { url: lastImageBase64 },
                role: 'last_frame'
            })
            _ulogInfo(`[ARK Video] 首尾帧模式`)
        } else if (hasFirstFrame && imageBase64) {
            content.push({
                type: 'image_url',
                image_url: { url: imageBase64 }
            })
        }

        // 2026-05-22 — Seedance 2.0 multi-modal: append reference_image entries.
        // Pre-validated above to be empty for non-2.0 models. Resolve URLs to
        // base64 in series (the per-ref upload cost is small but keeping
        // ordering deterministic matches Seedance's @1/@2 conventions in the
        // prompt body).
        if (Array.isArray(referenceImages) && referenceImages.length > 0) {
            for (const url of referenceImages) {
                if (typeof url !== 'string' || !url.trim()) continue
                const refBase64 = await imageUrlToBase64(url)
                content.push({
                    type: 'image_url',
                    image_url: { url: refBase64 },
                    role: 'reference_image',
                })
            }
            _ulogInfo(`[ARK Video] multi-modal refs 数: ${referenceImages.length}`)
        }

        const requestBody: {
            model: string
            content: ArkVideoContentItem[]
            resolution?: '480p' | '720p' | '1080p'
            ratio?: string
            duration?: number
            frames?: number
            seed?: number
            camera_fixed?: boolean
            watermark?: boolean
            return_last_frame?: boolean
            service_tier?: 'default' | 'flex'
            execution_expires_after?: number
            generate_audio?: boolean
            draft?: boolean
        } = {
            model: realModel,
            content
        }

        if (resolution === '480p' || resolution === '720p' || resolution === '1080p') {
            requestBody.resolution = resolution
        }
        if (aspectRatio) {
            requestBody.ratio = aspectRatio
        }
        if (typeof duration === 'number') {
            requestBody.duration = duration
        }
        if (typeof frames === 'number') {
            requestBody.frames = frames
        }
        if (typeof seed === 'number') {
            requestBody.seed = seed
        }
        if (typeof cameraFixed === 'boolean') {
            requestBody.camera_fixed = cameraFixed
        }
        if (typeof watermark === 'boolean') {
            requestBody.watermark = watermark
        }
        if (typeof returnLastFrame === 'boolean') {
            requestBody.return_last_frame = returnLastFrame
        }
        if (typeof draft === 'boolean') {
            requestBody.draft = draft
        }
        if (serviceTier !== undefined) {
            requestBody.service_tier = serviceTier
        }
        if (typeof executionExpiresAfter === 'number') {
            requestBody.execution_expires_after = executionExpiresAfter
        }

        // 批量模式参数
        if (isBatchMode) {
            requestBody.service_tier = 'flex'
            if (requestBody.execution_expires_after === undefined) {
                requestBody.execution_expires_after = 86400
            }
            _ulogInfo('[ARK Video] 批量模式: service_tier=flex')
        }

        // 音频生成（仅 Seedance 1.5 Pro）
        if (generateAudio !== undefined) {
            requestBody.generate_audio = generateAudio
        }

        try {
            const taskData = await arkCreateVideoTask(requestBody, {
                apiKey,
                logPrefix: '[ARK Video]'
            })

            const taskId = taskData.id

            if (!taskId) {
                throw new Error('ARK 未返回 task_id')
            }

            _ulogInfo(`[ARK Video] 任务已创建: ${taskId}`)

            return {
                success: true,
                async: true,
                requestId: taskId,  // 向后兼容
                externalId: `ARK:VIDEO:${taskId}`  // 🔥 标准格式
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : '未知错误'
            _ulogError(`[ARK Video] 创建任务失败:`, message)
            throw new Error(`ARK 视频任务创建失败: ${message}`)
        }
    }
}

// ============================================================
// 向后兼容别名
// ============================================================

export const ArkSeedreamGenerator = ArkImageGenerator
export const ArkSeedanceVideoGenerator = ArkVideoGenerator
