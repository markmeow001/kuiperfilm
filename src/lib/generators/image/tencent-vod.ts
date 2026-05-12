/**
 * 騰訊雲 VOD AIGC 圖片生成器
 *
 * API:
 * - 提交: vod.CreateAigcImageTask
 * - 輪詢: vod.DescribeTaskDetail (response.AigcImageTask)
 *
 * Provider key: tencent-vod
 *
 * 模型命名：
 *   GEM-2.5、GEM-3.0、GEM-3.1（Google nano banana 系列）
 *   OG-image2_low、OG-image2_medium、OG-image2_high（gpt-image2）
 *   Qwen-0925
 *   SI-4.5、SI-5.0-lite（豆包 Seedream image）
 *   Kling-2.1、Vidu-q2、Jimeng-4.0、Hunyuan-3.0
 *
 * 憑證儲存（apiKey 欄位為加密 JSON）：
 *   { "secretId": "...", "secretKey": "...", "subAppId": 1500044236, "region": "ap-guangzhou" }
 */

import { BaseImageGenerator, type ImageGenerateParams, type GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { createScopedLogger } from '@/lib/logging/core'
import { vod } from 'tencentcloud-sdk-nodejs-vod'

const VodClient = vod.v20180717.Client

interface TencentVODCredentials {
    secretId: string
    secretKey: string
    subAppId: number
    region?: string
}

function parseCredentials(apiKey: string): TencentVODCredentials {
    let parsed: unknown
    try {
        parsed = JSON.parse(apiKey)
    } catch {
        throw new Error('TENCENT_VOD_INVALID_CREDENTIALS: apiKey must be JSON with secretId/secretKey/subAppId')
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('TENCENT_VOD_INVALID_CREDENTIALS: apiKey JSON must be an object')
    }
    const obj = parsed as Record<string, unknown>
    const secretId = typeof obj.secretId === 'string' ? obj.secretId : ''
    const secretKey = typeof obj.secretKey === 'string' ? obj.secretKey : ''
    const subAppId = typeof obj.subAppId === 'number' ? obj.subAppId : Number(obj.subAppId)
    const region = typeof obj.region === 'string' && obj.region ? obj.region : 'ap-guangzhou'
    if (!secretId || !secretKey) {
        throw new Error('TENCENT_VOD_INVALID_CREDENTIALS: secretId and secretKey are required')
    }
    if (!Number.isFinite(subAppId) || subAppId <= 0) {
        throw new Error('TENCENT_VOD_INVALID_CREDENTIALS: subAppId is required')
    }
    return { secretId, secretKey, subAppId, region }
}

/**
 * Tencent VOD AIGC 圖片任務的 ModelName 合法值是
 *   OG, GG, Jimeng, SI, Qwen, Hunyuan, Vidu, Kling
 * (見 SDK vod_models.d.ts 對 CreateAigcImageTask 的 ModelName 說明)
 *
 * 我們前端 / DB 把 Google nano banana 系列叫做「GEM-3.1」,但 Tencent
 * 真正的 ModelName 是「GG」(GG 2.5 / GG 3.0 / GG 3.1)。原本直接送
 * ModelName="GEM" Tencent 會 silent fallback 走某個 default model,
 * 副作用是 AspectRatio 被忽略 — 用戶設 9:16 永遠出 16:9。
 *
 * 修法:在這層做 alias 映射,前端 UI / DB / capability catalog 都
 * 不用動,生成器內部把 GEM 翻譯成 GG 才送出去。
 */
const TENCENT_VOD_MODEL_NAME_ALIAS: Record<string, string> = {
  GEM: 'GG',
}

function splitModel(model: string): { name: string; version: string } {
    if (!model) return { name: '', version: '' }
    const idx = model.indexOf('-')
    if (idx === -1) return { name: model, version: '' }
    const rawName = model.slice(0, idx)
    const name = TENCENT_VOD_MODEL_NAME_ALIAS[rawName] ?? rawName
    return { name, version: model.slice(idx + 1) }
}

/**
 * Per-model reference image cap, sourced from Tencent VOD docs (last
 * verified 2026-05-13 against https://cloud.tencent.com/document/product/266/126240).
 *
 * Previous implementation hard-capped every model at 3 (a leftover from
 * the GG-2.5 era), silently dropping ref images for models with much
 * higher headroom — e.g. Kling-2.1 supports 4, GG-3.0/3.1 and SI-* support
 * 14, Kling-3.0-Omni supports 10. Dropping refs hurts identity / scene /
 * prop binding precision (the whole reason a caller passes multiple refs).
 *
 * Keys are `<modelName>-<modelVersion>` AFTER alias resolution
 * (e.g. "GG-3.1", "Kling-2.1"). Unknown models fall back to a conservative
 * cap of 3 so we never accidentally over-send and trigger a Tencent reject.
 */
const TENCENT_VOD_REF_CAP_BY_MODEL: Record<string, number> = {
    // GG (Google nano-banana series; aliased from GEM)
    'GG-2.5': 3,
    'GG-3.0': 14,
    'GG-3.1': 14,
    // Kling
    'Kling-2.1': 4,
    'Kling-3.0': 1,
    'Kling-3.0-Omni': 10,
    'Kling-O1': 10,
    // SI (Seedream)
    'SI-4.0': 14,
    'SI-4.5': 14,
    'SI-5.0-lite': 14,
    // Hunyuan
    'Hunyuan-3.0': 3,
    // Vidu
    'Vidu-q2': 7,
    // Qwen
    'Qwen-0925': 1,
}

const TENCENT_VOD_REF_CAP_DEFAULT = 3

function maxReferenceImagesForModel(modelName: string, modelVersion: string): number {
    const key = `${modelName}-${modelVersion}`
    const cap = TENCENT_VOD_REF_CAP_BY_MODEL[key]
    return typeof cap === 'number' ? cap : TENCENT_VOD_REF_CAP_DEFAULT
}

interface TencentVODImageOptions {
    modelId?: string
    aspectRatio?: string
    resolution?: string
    enhancePrompt?: 'Enabled' | 'Disabled'
    seed?: number
    negativePrompt?: string
    /**
     * 結果存儲類型。預設 Temporary；Permanent 將結果存入 VOD 並回傳
     * FileId，下游 stage（如 i2v、超分）可走內網拉取省流量。
     */
    storageMode?: 'Temporary' | 'Permanent'
}

export class TencentVODImageGenerator extends BaseImageGenerator {
    constructor(private readonly providerId: string = 'tencent-vod') {
        super()
    }

    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params
        const config = await getProviderConfig(userId, this.providerId)
        const creds = parseCredentials(config.apiKey)

        const opts = options as TencentVODImageOptions
        const modelKey = opts.modelId || ''
        const { name: modelName, version: modelVersion } = splitModel(modelKey)
        if (!modelName) {
            throw new Error('TENCENT_VOD_MODEL_REQUIRED: provide options.modelId like "GEM-3.1"')
        }

        const logger = createScopedLogger({
            module: 'worker.tencent-vod-image',
            action: 'tencent_vod_image_generate',
        })

        const client = new VodClient({
            credential: { secretId: creds.secretId, secretKey: creds.secretKey },
            region: creds.region!,
            profile: { httpProfile: { endpoint: 'vod.tencentcloudapi.com' } },
        })

        // FileInfos: 參考圖。每模型上限不同，見 TENCENT_VOD_REF_CAP_BY_MODEL。
        //
        // iangyc 2026-05-12 debug trail:
        // 1. Tried mirroring the video-side shape (Category + Usage +
        //    ObjectId) — Tencent rejected `Category` first, then
        //    `Usage` once Category was dropped. The image AIGC endpoint
        //    only accepts a bare `{Type, Url}` envelope; identity-
        //    anchor semantics (Usage='Reference') live only on the
        //    video endpoint.
        // 2. Net implication: GEM-3.1 / nano-banana on Tencent VOD has
        //    no way to declare "this ref IS the character identity" —
        //    refs are passed but the model treats them as soft style
        //    context only. For strong identity preservation, callers
        //    should switch storyboardModel to Kling-2.1 (or another
        //    image model with identity-aware capabilities).
        // 3. 2026-05-13: per-model cap unlocked (was hard-coded 3 for
        //    all models — that was correct only for GG-2.5 / Hunyuan-3.0).
        //    Kling-2.1 = 4, GG-3.x / SI-* = 14, Kling-3.0-Omni = 10, etc.
        const refCap = maxReferenceImagesForModel(modelName, modelVersion)
        const fileInfos: Record<string, unknown>[] = []
        const droppedAtCap = Math.max(0, referenceImages.length - refCap)
        for (const ref of referenceImages.slice(0, refCap)) {
            if (!ref || ref.startsWith('data:')) continue // 不支援 base64，需要 URL
            fileInfos.push({ Type: 'Url', Url: ref })
        }
        if (droppedAtCap > 0) {
            logger.warn({
                message: 'tencent-vod-image: reference images exceeded per-model cap, extras dropped',
                details: {
                    modelName,
                    modelVersion,
                    cap: refCap,
                    received: referenceImages.length,
                    dropped: droppedAtCap,
                },
            })
        }

        const outputConfig: Record<string, unknown> = {
            StorageMode: opts.storageMode ?? 'Temporary',
        }
        if (opts.aspectRatio) outputConfig.AspectRatio = opts.aspectRatio
        if (opts.resolution) outputConfig.Resolution = opts.resolution

        const req: Record<string, unknown> = {
            SubAppId: creds.subAppId,
            ModelName: modelName,
            ModelVersion: modelVersion || undefined,
            Prompt: prompt,
            OutputConfig: outputConfig,
        }
        if (fileInfos.length) req.FileInfos = fileInfos
        // 2026-05-13 — explicitly disable Tencent's prompt auto-optimizer.
        // Per the kling-style-binding research doc (document/kling-style-binding-research.md
        // section "發現 3"): EnhancePrompt='Enabled' (Tencent's default when
        // omitted) silently rewrites the prompt toward "generic / more
        // realistic" output. That rewrite is the single most common cause
        // of style drift because it erases style anchors (e.g. our
        // realistic preset's "DSLR / film grain / NOT CG" directives) and
        // pulls Kling-2.1 back toward its CG/Genshin training bias.
        // Override possible via opts.enhancePrompt='Enabled' if a caller
        // ever wants Tencent's optimizer back on for a specific task.
        req.EnhancePrompt = opts.enhancePrompt ?? 'Disabled'
        if (opts.negativePrompt) req.NegativePrompt = opts.negativePrompt
        if (typeof opts.seed === 'number') req.Seed = opts.seed

        logger.info({
            message: 'Tencent VOD image task submit',
            details: {
                modelName,
                modelVersion,
                refCount: fileInfos.length,
                aspectRatio: opts.aspectRatio,
                resolution: opts.resolution,
                promptLength: prompt.length,
            },
        })

        const resp = await client.CreateAigcImageTask(req as never)
        const taskId = (resp as { TaskId?: string }).TaskId
        if (!taskId) {
            throw new Error('TENCENT_VOD_NO_TASK_ID: CreateAigcImageTask returned empty TaskId')
        }

        logger.info({ message: 'Tencent VOD image task submitted', details: { taskId } })

        return {
            success: true,
            async: true,
            externalId: `TENCENTVOD:IMAGE:${taskId}`,
        }
    }
}
