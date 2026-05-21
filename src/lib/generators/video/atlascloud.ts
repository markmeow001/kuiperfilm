/**
 * AtlasCloud 视频生成器
 *
 * 模型：
 * - seedance-v1.5-pro        (Seedance v1.5 Pro image-to-video)
 * - wan-2.6                  (Alibaba Wan 2.6 image-to-video flash)
 * - seedance-2.0-t2v         (Seedance 2.0 Pro text-to-video, native audio)
 * - seedance-2.0-i2v         (Seedance 2.0 Pro image-to-video, native audio)
 * - seedance-2.0-fast-t2v    (Seedance 2.0 Fast text-to-video, native audio)
 * - seedance-2.0-fast-i2v    (Seedance 2.0 Fast image-to-video, native audio)
 *
 * t2v 變體不送 body.image — 純文字驅動。
 *
 * API:
 * - 提交: POST https://api.atlascloud.ai/api/v1/model/generateVideo
 *         body.model 帶入下方 slug
 * - 轮询: GET  https://api.atlascloud.ai/api/v1/model/prediction/{requestId}
 *
 * status: created | processing | completed | failed
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
}

const ATLASCLOUD_MODEL_MAP: Record<string, string> = {
    'seedance-v1.5-pro': 'bytedance/seedance-v1.5-pro/image-to-video-fast',
    'wan-2.6': 'alibaba/wan-2.6/image-to-video-flash',
    'seedance-2.0-t2v': 'bytedance/seedance-2.0/text-to-video',
    'seedance-2.0-i2v': 'bytedance/seedance-2.0/image-to-video',
    'seedance-2.0-fast-t2v': 'bytedance/seedance-2.0-fast/text-to-video',
    'seedance-2.0-fast-i2v': 'bytedance/seedance-2.0-fast/image-to-video',
}

function isTextToVideoSlug(slug: string): boolean {
    return slug.endsWith('/text-to-video')
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
        } = options as AtlasCloudOptions

        const atlasModel = resolveAtlasCloudModel(modelId)
        const t2vMode = isTextToVideoSlug(atlasModel)

        const logger = createScopedLogger({
            module: 'worker.atlascloud-video',
            action: 'atlascloud_video_generate',
        })

        // AtlasCloud body shape (per /docs/...?tab=api, verified 2026-05-20):
        //   { "model": "<slug>", "input": { "prompt": "...", ... } }
        // Everything except `model` lives inside `input`. Earlier code path
        // sent flat top-level fields — that may have silently worked for the
        // legacy v1.5-pro/wan-2.6 bindings via gateway leniency, but the new
        // seedance-2.0 endpoints will not parse them.
        const input: Record<string, unknown> = {
            duration,
            aspect_ratio: aspectRatio,
            generate_audio: generateAudio,
            camera_fixed: cameraFixed,
            resolution,
            seed,
        }

        if (!t2vMode) {
            input.image = imageUrl
            if (lastFrameImageUrl) {
                input.last_image = lastFrameImageUrl
            }
        }

        if (paramPrompt) {
            input.prompt = paramPrompt
        } else if (t2vMode) {
            throw new Error(
                `AtlasCloud ${atlasModel} 為 text-to-video 模型，但 params.prompt 為空`,
            )
        }

        const body = { model: atlasModel, input }

        logger.info({
            message: 'AtlasCloud Seedance video generation request',
            details: {
                model: atlasModel,
                mode: t2vMode ? 't2v' : 'i2v',
                duration,
                aspectRatio,
                generateAudio,
                cameraFixed,
                hasImage: !t2vMode && !!imageUrl,
                hasPrompt: !!paramPrompt,
                hasLastFrame: !t2vMode && !!lastFrameImageUrl,
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

        // Submit response — old wrapped shape `{code, message, data:{id}}`
        // OR new flat shape `{id, status, model, created_at}`. Handle both;
        // the docs example shows flat but legacy v1.5-pro went through the
        // wrapped path so we cannot rely on either side exclusively.
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
            details: { requestId, status: responseBody.data?.status },
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
        case 'failed': {
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
