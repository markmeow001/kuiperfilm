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
 * Kling 3.0 / 3.0-Omni 多鏡頭參數。
 *
 * Two operating modes per Tencent VOD AIGC doc (2026-02-14, updated
 * 2026-04-24):
 *
 *   1. Intelligence mode — model decides shot boundaries on its own:
 *        { multi_shot: 'intelligence' }                            (legacy form)
 *      or
 *        { multi_shot: true, shot_type: 'intelligence' }           (current spec form)
 *      with the top-level Prompt holding the combined script.
 *
 *   2. Customize mode — caller supplies per-shot prompt + duration:
 *        { multi_shot: true, shot_type: 'customize',
 *          multi_prompt: [{ index, prompt, duration }, ...] }
 *      Top-level Prompt is ignored. Sum of durations must equal the
 *      task's total Duration; each shot 1-15s; max 6 shots; each
 *      prompt ≤512 chars.
 */
type KlingMultiShotMode = boolean | 'intelligence' | string

interface KlingMultiShotPromptEntry {
    index: number
    prompt: string
    duration: number | string
}

interface KlingMultiShotOptions {
    multi_shot?: KlingMultiShotMode
    shot_type?: 'intelligence' | 'customize' | string
    /** @deprecated typo on the older changelog; kept for back-compat read */
    short_type?: string
    /**
     * Customize-mode shot list. When provided the generator embeds it
     * as an array (per spec); the older string form is still accepted
     * for callers built before the array shape was documented.
     */
    multi_prompt?: KlingMultiShotPromptEntry[] | string
}

type ToggleFlag = 'Enabled' | 'Disabled'

interface TencentVODVideoOptions {
    modelId?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    audioGeneration?: ToggleFlag
    /**
     * Boolean alias for audioGeneration coming from the upstream worker
     * (video.worker.ts passes `generateAudio: boolean`). Mapped to
     * AudioGeneration='Enabled'/'Disabled' before submit.
     */
    generateAudio?: boolean
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
            // Per VOD AIGC 接入指南 §3.9.2:
            //   "②若希望实现参考生视频...多图情况下，默认参考生视频"
            //   "ObjectId不为空即可，value自定义"
            //
            // Kling 3.0-Omni's multi-image anchoring expects each
            // FileInfo to carry an ObjectId so the prompt's
            // `<<<image_N>>>` placeholders can resolve to the right
            // image (1-indexed, matches FileInfos array order).
            // Without ObjectId, Kling treats single-image refs as
            // first-frame mode and ignores the rest.
            opts.referenceImageUrls.forEach((url, idx) => {
                if (!url) return
                fileInfos.push({
                    Type: 'Url',
                    Category: 'Image',
                    Url: url,
                    Usage: 'Reference',
                    ObjectId: `ref_${idx + 1}`,
                })
            })
        }

        const outputConfig: Record<string, unknown> = {
            StorageMode: opts.storageMode ?? 'Temporary',
        }
        if (opts.duration) outputConfig.Duration = opts.duration
        if (opts.resolution) outputConfig.Resolution = opts.resolution
        if (opts.aspectRatio) outputConfig.AspectRatio = opts.aspectRatio
        // AudioGeneration: prefer explicit ToggleFlag, fall back to the boolean
        // alias coming from video.worker (Kling 3.0 / Omni "音畫同出").
        if (opts.audioGeneration) {
            outputConfig.AudioGeneration = opts.audioGeneration
        } else if (opts.generateAudio === true) {
            outputConfig.AudioGeneration = 'Enabled'
        } else if (opts.generateAudio === false) {
            outputConfig.AudioGeneration = 'Disabled'
        }
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
        // 2026-05-13 — explicitly disable Tencent's prompt auto-optimizer.
        // Mirror of the image-side fix; same rationale: Tencent's default
        // EnhancePrompt='Enabled' silently rewrites style anchors away,
        // causing style drift across Kling video output too. See
        // document/kling-style-binding-research.md "發現 3" for the full
        // research trail. Override via opts.enhancePrompt='Enabled' if
        // any caller ever wants Tencent's optimizer back on.
        req.EnhancePrompt = opts.enhancePrompt ?? 'Disabled'
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
                subjectInfoCount: Array.isArray(req.SubjectInfos) ? req.SubjectInfos.length : 0,
                hasMultiShot: Boolean((req.ExtInfo as string | undefined)?.includes('multi_shot')),
                outputAspectRatio: (outputConfig as { AspectRatio?: string }).AspectRatio ?? null,
            },
        })

        let resp: unknown
        try {
            resp = await client.CreateAigcVideoTask(req as never)
        } catch (err) {
            // Tencent SDK surfaces 70000 (RequestLimitExceeded) at submit
            // time when the account-level concurrency quota is full
            // BEFORE the task even gets queued. Tag the thrown error
            // with code='RATE_LIMIT' so BullMQ's rate-limit-aware
            // backoff (60/120/240s ramp) kicks in instead of the
            // default 2/4/8s exponential — same treatment as a
            // post-submit FINISH-state 70000.
            const msg = err instanceof Error ? err.message : String(err)
            const isRateLimit = /70000|requestlimitexceeded|maximum concurrency/i.test(msg)
            if (isRateLimit) {
                const wrapped = new Error(`Tencent VOD submit rate-limited: ${msg}`)
                ;(wrapped as unknown as { code: string }).code = 'RATE_LIMIT'
                throw wrapped
            }
            throw err
        }
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
