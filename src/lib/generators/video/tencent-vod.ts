/**
 * 騰訊雲 VOD AIGC 視頻生成器
 *
 * API:
 * - 提交: vod.CreateAigcVideoTask
 * - 輪詢: vod.DescribeTaskDetail (response.AigcVideoTask)
 *
 * Provider key: tencent-vod
 *
 * 模型命名（apiKey 中傳入時為 ModelName-ModelVersion 格式）：
 *   Kling-3.0、Kling-3.0-Omni、Kling-2.6、Kling-2.5、Kling-2.1、Kling-2.0、Kling-1.6、Kling-O1
 *   Vidu-q3、Vidu-q3-pro、Vidu-q3-mix、Vidu-q3-turbo、Vidu-q2、Vidu-q2-pro、Vidu-q2-turbo
 *   Hailuo-02、Hailuo-2.3、Hailuo-2.3-fast
 *   PixVerse-v6、PixVerse-v5.6、PixVerse-c1
 *   GV-3.1、GV-3.1-fast、OS-2.0、Jimeng-3.0pro、Hunyuan-1.5
 *
 * 憑證儲存（apiKey 欄位為加密 JSON）：
 *   { "secretId": "...", "secretKey": "...", "subAppId": 1500044236, "region": "ap-guangzhou" }
 */

import { BaseVideoGenerator, type VideoGenerateParams, type GenerateResult } from '../base'
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
        throw new Error('TENCENT_VOD_INVALID_CREDENTIALS: apiKey must be a JSON object with secretId/secretKey/subAppId')
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
        throw new Error('TENCENT_VOD_INVALID_CREDENTIALS: subAppId is required and must be a positive integer')
    }
    return { secretId, secretKey, subAppId, region }
}

/**
 * 解析 "Kling-3.0-Omni" 為 { name: "Kling", version: "3.0-Omni" }
 * 用 SplitN 邏輯：第一個 `-` 之前是 name，之後是 version
 */
function splitModel(model: string): { name: string; version: string } {
    if (!model) return { name: '', version: '' }
    const idx = model.indexOf('-')
    if (idx === -1) return { name: model, version: '' }
    return { name: model.slice(0, idx), version: model.slice(idx + 1) }
}

/**
 * 固定主體輸入資訊（角色一致性）。
 * - Kling: Id 必填，Name 選填
 * - Vidu: Name 必填（prompt 用 [@name] 引用），Id/VoiceId/ImageUrls/VideoUrls 選填
 * 來源：Tencent VOD AIGC SubjectInfos.N
 */
interface TencentVODSubjectInfo {
    id?: string
    name?: string
    voiceId?: string
    imageUrls?: string[]
    videoUrls?: string[]
}

/**
 * Kling 3.0 / 3.0-Omni 智能分鏡參數。
 * 透過 ExtInfo 序列化送出 — Tencent VOD 文件 2026-02-14 新增。
 *   - multi_shot="intelligence" 表示模型自動依 prompt 切多鏡頭
 *   - short_type / multi_prompt 為短劇場景擴充參數
 */
interface KlingMultiShotOptions {
    multi_shot?: 'intelligence' | string
    short_type?: string
    multi_prompt?: string
}

type ToggleFlag = 'Enabled' | 'Disabled'

interface TencentVODVideoOptions {
    modelId?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    audioGeneration?: ToggleFlag
    enhancePrompt?: ToggleFlag
    sceneType?: string
    seed?: number
    inputRegion?: 'Mainland' | 'Oversea'
    lastFrameUrl?: string
    referenceImageUrls?: string[]
    referenceUsage?: 'FirstFrame' | 'Reference'
    subjectInfos?: TencentVODSubjectInfo[]
    klingMultiShot?: KlingMultiShotOptions
    /**
     * 任意 ExtInfo 通透 — 任何尚未在 typed options 涵蓋的 model-specific
     * 參數都可從這邊傳入。Key 衝突時 extInfo 覆蓋 klingMultiShot。
     */
    extInfo?: Record<string, unknown>
    /**
     * 結果存儲類型。預設 Temporary（短期 URL，doc 預設）；
     * Permanent 會將結果存入 VOD 並回傳 FileId，後續 pipeline stage
     * 可用 FileId 走內網拉取省流量。多 stage 串接（如 storyboard →
     * video → 後處理）建議用 Permanent。
     */
    storageMode?: 'Temporary' | 'Permanent'
    // —— OutputConfig 進階欄位 (doc 3.2.2) ——
    /** Vidu 智能插帧 */
    frameInterpolate?: ToggleFlag
    /** 錯峰模式（有折扣） */
    offPeak?: ToggleFlag
    /** 圖標水印（目前僅 Vidu 支援） */
    logoAdd?: ToggleFlag
    /** 輸入內容合規性檢查 */
    inputComplianceCheck?: ToggleFlag
    /** 輸出內容合規性檢查（production 上線建議開啟） */
    outputComplianceCheck?: ToggleFlag
}

/** 從 typed options 組出最終 ExtInfo payload；無欄位則回 null。 */
function buildExtInfoPayload(opts: TencentVODVideoOptions): Record<string, unknown> | null {
    const merged: Record<string, unknown> = {}
    if (opts.klingMultiShot) {
        for (const [k, v] of Object.entries(opts.klingMultiShot)) {
            if (v !== undefined && v !== '') merged[k] = v
        }
    }
    if (opts.extInfo) {
        for (const [k, v] of Object.entries(opts.extInfo)) {
            if (v !== undefined) merged[k] = v
        }
    }
    return Object.keys(merged).length > 0 ? merged : null
}

/** 將內部 camelCase subject 物件轉為 Tencent API 的 PascalCase；空物件返回 null。 */
function buildSubjectInfo(subject: TencentVODSubjectInfo): Record<string, unknown> | null {
    const out: Record<string, unknown> = {}
    if (subject.id) out.Id = subject.id
    if (subject.name) out.Name = subject.name
    if (subject.voiceId) out.VoiceId = subject.voiceId
    if (subject.imageUrls?.length) out.ImageUrls = subject.imageUrls
    if (subject.videoUrls?.length) out.VideoUrls = subject.videoUrls
    return Object.keys(out).length > 0 ? out : null
}

export class TencentVODVideoGenerator extends BaseVideoGenerator {
    constructor(private readonly providerId: string = 'tencent-vod') {
        super()
    }

    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt = '', options = {} } = params
        const config = await getProviderConfig(userId, this.providerId)
        const creds = parseCredentials(config.apiKey)

        const opts = options as TencentVODVideoOptions
        const modelKey = opts.modelId || ''
        const { name: modelName, version: modelVersion } = splitModel(modelKey)
        if (!modelName) {
            throw new Error('TENCENT_VOD_MODEL_REQUIRED: provide options.modelId like "Kling-3.0"')
        }

        const logger = createScopedLogger({
            module: 'worker.tencent-vod-video',
            action: 'tencent_vod_video_generate',
        })

        const client = new VodClient({
            credential: { secretId: creds.secretId, secretKey: creds.secretKey },
            region: creds.region!,
            profile: { httpProfile: { endpoint: 'vod.tencentcloudapi.com' } },
        })

        // FileInfos: 首帧 (FirstFrame) + 参考图 (Reference)
        const fileInfos: Record<string, unknown>[] = []
        const usage = opts.referenceUsage || 'FirstFrame'
        if (imageUrl) {
            fileInfos.push({ Type: 'Url', Category: 'Image', Url: imageUrl, Usage: usage })
        }
        if (opts.referenceImageUrls?.length) {
            for (const url of opts.referenceImageUrls) {
                if (!url) continue
                fileInfos.push({ Type: 'Url', Category: 'Image', Url: url, Usage: 'Reference' })
            }
        }

        const outputConfig: Record<string, unknown> = {
            StorageMode: opts.storageMode ?? 'Temporary',
        }
        if (opts.duration) outputConfig.Duration = opts.duration
        if (opts.resolution) outputConfig.Resolution = opts.resolution
        if (opts.aspectRatio) outputConfig.AspectRatio = opts.aspectRatio
        if (opts.audioGeneration) outputConfig.AudioGeneration = opts.audioGeneration
        if (opts.frameInterpolate) outputConfig.FrameInterpolate = opts.frameInterpolate
        if (opts.offPeak) outputConfig.OffPeak = opts.offPeak
        if (opts.logoAdd) outputConfig.LogoAdd = opts.logoAdd
        if (opts.inputComplianceCheck) outputConfig.InputComplianceCheck = opts.inputComplianceCheck
        if (opts.outputComplianceCheck) outputConfig.OutputComplianceCheck = opts.outputComplianceCheck

        const req: Record<string, unknown> = {
            SubAppId: creds.subAppId,
            ModelName: modelName,
            ModelVersion: modelVersion || undefined,
            Prompt: prompt || undefined,
            OutputConfig: outputConfig,
        }
        if (fileInfos.length) req.FileInfos = fileInfos

        if (opts.subjectInfos?.length) {
            const subjectInfos = opts.subjectInfos
                .map(buildSubjectInfo)
                .filter((s): s is Record<string, unknown> => s !== null)
            if (subjectInfos.length) req.SubjectInfos = subjectInfos
        }

        if (opts.lastFrameUrl) req.LastFrameUrl = opts.lastFrameUrl
        if (opts.enhancePrompt) req.EnhancePrompt = opts.enhancePrompt
        if (opts.sceneType) req.SceneType = opts.sceneType
        if (typeof opts.seed === 'number') req.Seed = opts.seed
        if (opts.inputRegion) req.InputRegion = opts.inputRegion

        const extInfoPayload = buildExtInfoPayload(opts)
        if (extInfoPayload) req.ExtInfo = JSON.stringify(extInfoPayload)

        logger.info({
            message: 'Tencent VOD video task submit',
            details: {
                modelName,
                modelVersion,
                hasImage: !!imageUrl,
                refCount: opts.referenceImageUrls?.length || 0,
                duration: opts.duration,
                resolution: opts.resolution,
                aspectRatio: opts.aspectRatio,
            },
        })

        const resp = await client.CreateAigcVideoTask(req as never)
        const taskId = (resp as { TaskId?: string }).TaskId
        if (!taskId) {
            throw new Error('TENCENT_VOD_NO_TASK_ID: CreateAigcVideoTask returned empty TaskId')
        }

        logger.info({ message: 'Tencent VOD video task submitted', details: { taskId } })

        return {
            success: true,
            async: true,
            externalId: `TENCENTVOD:VIDEO:${taskId}`,
        }
    }
}
