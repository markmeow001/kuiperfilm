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

function splitModel(model: string): { name: string; version: string } {
    if (!model) return { name: '', version: '' }
    const idx = model.indexOf('-')
    if (idx === -1) return { name: model, version: '' }
    return { name: model.slice(0, idx), version: model.slice(idx + 1) }
}

interface TencentVODImageOptions {
    modelId?: string
    aspectRatio?: string
    resolution?: string
    enhancePrompt?: 'Enabled' | 'Disabled'
    seed?: number
    negativePrompt?: string
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

        // FileInfos: 參考圖（最多 3 張：GEM 系列限制）
        const fileInfos: Record<string, unknown>[] = []
        for (const ref of referenceImages.slice(0, 3)) {
            if (!ref || ref.startsWith('data:')) continue // 不支援 base64，需要 URL
            fileInfos.push({ Type: 'Url', Url: ref })
        }

        const outputConfig: Record<string, unknown> = { StorageMode: 'Temporary' }
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
        if (opts.enhancePrompt) req.EnhancePrompt = opts.enhancePrompt
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
