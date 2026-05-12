/**
 * Kie.ai Kling 3.0 视频生成器
 *
 * 模型：
 * - kling-3-0-std  (Kling 3.0 Standard)
 * - kling-3-0-pro  (Kling 3.0 Professional)
 *
 * API:
 * - 提交: POST https://api.kie.ai/api/v1/jobs/createTask
 * - 轮询: GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId={taskId}
 *
 * state: waiting | generating | success | fail
 */

import { BaseVideoGenerator, type VideoGenerateParams, type GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { createScopedLogger } from '@/lib/logging/core'

const KIEAI_BASE_URL = 'https://api.kie.ai'

export interface KlingElement {
    name: string
    description: string
    imageUrls: string[]
}

interface KieAIKlingOptions {
    modelId?: string
    mode?: 'std' | 'pro'
    duration?: number
    sound?: boolean
    aspectRatio?: string
    klingElements?: KlingElement[]
    prompt?: string
}

export interface MultiShotPromptItem {
    prompt: string
    duration: number
}

export interface MultiShotParams {
    userId: string
    imageUrl?: string
    multiPrompt: MultiShotPromptItem[]
    klingElements?: KlingElement[]
    options?: {
        mode?: 'std' | 'pro'
        sound?: boolean
        aspectRatio?: string
    }
}

function resolveKlingModel(_modelId?: string): string {
    // KieAI's Kling endpoint accepts only 'kling-3.0/video' on this
    // generator. _modelId is kept in the signature for symmetry with
    // resolveKlingMode and any future per-model routing.
    return 'kling-3.0/video'
}

function resolveKlingMode(modelId?: string, mode?: 'std' | 'pro'): string {
    if (mode) return mode
    if (modelId?.includes('pro')) return 'pro'
    return 'std'
}

export class KieAIKlingVideoGenerator extends BaseVideoGenerator {
    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt: paramPrompt = '', options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'kieai')

        const {
            modelId,
            mode,
            duration = 5,
            sound = true,
            aspectRatio = '16:9',
            klingElements,
            prompt: optionsPrompt,
        } = options as KieAIKlingOptions

        const prompt = optionsPrompt || paramPrompt

        const logger = createScopedLogger({
            module: 'worker.kieai-kling-video',
            action: 'kieai_kling_video_generate',
        })

        const input: Record<string, unknown> = {
            prompt,
            mode: resolveKlingMode(modelId, mode),
            duration: String(duration),
            sound,
            aspect_ratio: aspectRatio,
        }

        if (imageUrl) {
            input.image_urls = [imageUrl]
        }

        if (klingElements && klingElements.length > 0) {
            input.kling_elements = klingElements
        }

        const body = {
            model: resolveKlingModel(modelId),
            input,
        }

        logger.info({
            message: 'KieAI Kling video generation request',
            details: {
                model: body.model,
                mode: input.mode,
                duration,
                sound,
                aspectRatio,
                hasImage: !!imageUrl,
                hasElements: !!klingElements?.length,
                promptLength: prompt.length,
            },
        })

        const response = await fetch(`${KIEAI_BASE_URL}/api/v1/jobs/createTask`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`KieAI Kling 提交失败 (${response.status}): ${errorText}`)
        }

        const data = await response.json() as {
            code: number
            msg: string
            data: { taskId: string }
        }

        if (data.code !== 200) {
            throw new Error(`KieAI Kling 错误 (code ${data.code}): ${data.msg}`)
        }

        const taskId = data.data?.taskId
        if (!taskId) {
            throw new Error('KieAI Kling 未返回 taskId')
        }

        logger.info({
            message: 'KieAI Kling task submitted',
            details: { taskId },
        })

        return {
            success: true,
            async: true,
            externalId: `KIEAI:KLING:${taskId}`,
        }
    }

    /**
     * 多鏡頭生成 — 多個 panel 合成一段連貫影片
     */
    async generateMultiShot(params: MultiShotParams): Promise<GenerateResult> {
        const { userId, imageUrl, multiPrompt, klingElements, options = {} } = params
        const { apiKey } = await getProviderConfig(userId, 'kieai')

        const logger = createScopedLogger({
            module: 'worker.kieai-kling-video',
            action: 'kieai_kling_multi_shot_generate',
        })

        const input: Record<string, unknown> = {
            multi_shots: true,
            multi_prompt: multiPrompt.map((item) => ({
                prompt: item.prompt,
                duration: String(item.duration),
            })),
            mode: options.mode || 'pro',
            sound: options.sound ?? true,
            aspect_ratio: options.aspectRatio || '16:9',
        }

        if (imageUrl) {
            input.image_urls = [imageUrl]
        }

        if (klingElements && klingElements.length > 0) {
            input.kling_elements = klingElements
        }

        const body = {
            model: resolveKlingModel(),
            input,
        }

        logger.info({
            message: 'KieAI Kling multi-shot request',
            details: {
                model: body.model,
                shotCount: multiPrompt.length,
                mode: input.mode,
                hasElements: !!klingElements?.length,
            },
        })

        const response = await fetch(`${KIEAI_BASE_URL}/api/v1/jobs/createTask`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`KieAI Kling multi-shot 提交失败 (${response.status}): ${errorText}`)
        }

        const data = await response.json() as {
            code: number
            msg: string
            data: { taskId: string }
        }

        if (data.code !== 200) {
            throw new Error(`KieAI Kling multi-shot 错误 (code ${data.code}): ${data.msg}`)
        }

        const taskId = data.data?.taskId
        if (!taskId) {
            throw new Error('KieAI Kling multi-shot 未返回 taskId')
        }

        logger.info({
            message: 'KieAI Kling multi-shot task submitted',
            details: { taskId, shotCount: multiPrompt.length },
        })

        return {
            success: true,
            async: true,
            externalId: `KIEAI:KLING:${taskId}`,
        }
    }
}

/**
 * 查询 Kie.ai Kling 任务状态（供 async-poll 调用）
 */
export async function queryKieAIKlingTaskStatus(
    taskId: string,
    apiKey: string,
): Promise<{ status: 'pending' | 'completed' | 'failed'; videoUrl?: string; error?: string }> {
    const response = await fetch(
        `${KIEAI_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
        },
    )

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`KieAI Kling 查询失败 (${response.status}): ${errorText}`)
    }

    const data = await response.json() as {
        code: number
        msg: string
        data: Record<string, unknown> & {
            taskId: string
            state: string // waiting | generating | success | fail
            resultJson: string | null // JSON string containing { resultUrls: string }
            errorMessage: string | null
        }
    }

    const logger = createScopedLogger({ module: 'worker.kieai-kling-video', action: 'kieai_kling_video_poll' })
    const state = data.data?.state
    logger.info({
        message: 'KieAI Kling poll response',
        details: {
            taskId,
            state,
            hasResultJson: !!data.data?.resultJson,
            errorMessage: data.data?.errorMessage,
            ...(state === 'success' ? {
                rawDataKeys: Object.keys(data.data || {}),
                resultJsonPreview: data.data?.resultJson?.slice(0, 500),
            } : {}),
        },
    })

    switch (state) {
        case 'success': {
            let videoUrl: string | undefined
            try {
                const resultJson = JSON.parse(data.data.resultJson || '{}')
                const resultUrls = typeof resultJson.resultUrls === 'string'
                    ? JSON.parse(resultJson.resultUrls)
                    : resultJson.resultUrls
                if (Array.isArray(resultUrls) && resultUrls.length > 0) {
                    videoUrl = resultUrls[0]
                }
            } catch {
                // fallback: try parsing resultJson directly as URL array
                if (data.data.resultJson) {
                    try {
                        const urls = JSON.parse(data.data.resultJson)
                        if (Array.isArray(urls) && urls.length > 0) {
                            videoUrl = urls[0]
                        }
                    } catch {
                        // ignore
                    }
                }
            }
            if (!videoUrl) {
                return {
                    status: 'failed',
                    error: 'KieAI Kling: 视频生成完成但未返回视频URL',
                }
            }
            return {
                status: 'completed',
                videoUrl,
            }
        }
        case 'fail': {
            const errorDetail = data.data.errorMessage || data.msg || '(无错误信息)'
            logger.error({
                message: 'KieAI Kling 视频生成失败',
                details: {
                    taskId,
                    state,
                    errorMessage: data.data.errorMessage,
                    apiMsg: data.msg,
                    apiCode: data.code,
                    resultJson: data.data.resultJson?.substring(0, 300),
                },
            })
            return {
                status: 'failed',
                error: `KieAI Kling: 生成失败 — ${errorDetail}`,
            }
        }
        case 'waiting':
        case 'generating':
        default:
            return {
                status: 'pending',
            }
    }
}
