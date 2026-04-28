/**
 * AtlasCloud Seedance v1.5 Pro 视频生成器
 *
 * 模型：
 * - seedance-v1.5-pro  (Seedance v1.5 Pro image-to-video)
 *
 * API:
 * - 提交: POST https://api.atlascloud.ai/v1/model/bytedance/seedance-v1.5-pro/image-to-video-fast
 * - 轮询: GET  https://api.atlascloud.ai/v1/model/prediction/{requestId}
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

        const logger = createScopedLogger({
            module: 'worker.atlascloud-video',
            action: 'atlascloud_video_generate',
        })

        const body: Record<string, unknown> = {
            model: atlasModel,
            image: imageUrl,
            duration,
            aspect_ratio: aspectRatio,
            generate_audio: generateAudio,
            camera_fixed: cameraFixed,
            resolution,
            seed,
        }

        if (paramPrompt) {
            body.prompt = paramPrompt
        }

        if (lastFrameImageUrl) {
            body.last_image = lastFrameImageUrl
        }

        logger.info({
            message: 'AtlasCloud Seedance video generation request',
            details: {
                duration,
                aspectRatio,
                generateAudio,
                cameraFixed,
                hasImage: !!imageUrl,
                hasPrompt: !!paramPrompt,
                hasLastFrame: !!lastFrameImageUrl,
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

        const responseBody = await response.json() as {
            code: number
            message: string
            data: {
                id: string
                model: string
                status: string
                urls?: { get?: string }
            }
        }

        if (responseBody.code !== 200) {
            throw new Error(`AtlasCloud Seedance 错误 (code ${responseBody.code}): ${responseBody.message}`)
        }

        const requestId = responseBody.data?.id
        if (!requestId) {
            throw new Error(`AtlasCloud Seedance 未返回 prediction ID`)
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
