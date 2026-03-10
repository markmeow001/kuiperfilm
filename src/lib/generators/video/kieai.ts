/**
 * Kie.ai Veo 视频生成器
 *
 * 模型：
 * - veo3      (Veo 3.1 Quality)
 * - veo3_fast (Veo 3.1 Fast, 默认)
 *
 * API:
 * - 提交: POST https://api.kie.ai/api/v1/veo/generate
 * - 轮询: GET  https://api.kie.ai/api/v1/veo/record-info?taskId={taskId}
 *
 * generationType:
 * - TEXT_2_VIDEO                    (文生视频)
 * - FIRST_AND_LAST_FRAMES_2_VIDEO   (首尾帧生视频)
 * - REFERENCE_2_VIDEO               (参考图生视频, 1-3张)
 *
 * successFlag: 0=generating, 1=success, 2=create_failed, 3=generate_failed
 */

import { BaseVideoGenerator, type VideoGenerateParams, type GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { createScopedLogger } from '@/lib/logging/core'

const KIEAI_BASE_URL = 'https://api.kie.ai'

interface KieAIVeoOptions {
    modelId?: string
    aspectRatio?: string
    lastFrameImageUrl?: string
    enableTranslation?: boolean
}

export class KieAIVideoGenerator extends BaseVideoGenerator {
    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt = '', options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'kieai')

        const {
            modelId = 'veo3_fast',
            aspectRatio = '16:9',
            lastFrameImageUrl,
            enableTranslation = true,
        } = options as KieAIVeoOptions

        const logger = createScopedLogger({
            module: 'worker.kieai-video',
            action: 'kieai_video_generate',
        })

        // KieAI Veo: REFERENCE_2_VIDEO 和 FIRST_AND_LAST_FRAMES_2_VIDEO 只支持 veo3_fast
        const needsImageInput = !!imageUrl
        const effectiveModelId = needsImageInput && modelId !== 'veo3_fast' ? 'veo3_fast' : modelId

        const body: Record<string, unknown> = {
            prompt,
            model: effectiveModelId,
            aspect_ratio: aspectRatio,
            enableTranslation,
        }

        // 确定 generationType
        if (imageUrl && lastFrameImageUrl) {
            // 首尾帧模式
            body.generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO'
            body.imageUrls = [imageUrl, lastFrameImageUrl]
        } else if (imageUrl) {
            // 单张参考图模式
            body.generationType = 'REFERENCE_2_VIDEO'
            body.imageUrls = [imageUrl]
        } else {
            // 纯文本模式
            body.generationType = 'TEXT_2_VIDEO'
        }

        logger.info({
            message: 'KieAI video generation request',
            details: {
                model: modelId,
                generationType: body.generationType,
                aspectRatio,
                hasImage: !!imageUrl,
                hasLastFrame: !!lastFrameImageUrl,
                promptLength: prompt.length,
            },
        })

        const response = await fetch(`${KIEAI_BASE_URL}/api/v1/veo/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`KieAI video 提交失败 (${response.status}): ${errorText}`)
        }

        const data = await response.json() as {
            code: number
            msg: string
            data: { taskId: string }
        }

        if (data.code !== 200) {
            throw new Error(`KieAI video 错误 (code ${data.code}): ${data.msg}`)
        }

        const taskId = data.data?.taskId
        if (!taskId) {
            throw new Error('KieAI video 未返回 taskId')
        }

        logger.info({
            message: 'KieAI video task submitted',
            details: { taskId },
        })

        return {
            success: true,
            async: true,
            externalId: `KIEAI:VIDEO:${taskId}`,
        }
    }
}

/**
 * 查询 Kie.ai 视频任务状态（供 async-poll 调用）
 */
export async function queryKieAIVideoTaskStatus(
    taskId: string,
    apiKey: string,
): Promise<{ status: 'pending' | 'completed' | 'failed'; videoUrl?: string; error?: string }> {
    const response = await fetch(
        `${KIEAI_BASE_URL}/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
        },
    )

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`KieAI video 查询失败 (${response.status}): ${errorText}`)
    }

    const data = await response.json() as {
        code: number
        msg: string
        data: Record<string, unknown> & {
            taskId: string
            successFlag: number // 0=generating, 1=success, 2=create_failed, 3=generate_failed
            resultUrls: string | null // JSON string of URL array (旧版)
            response?: Record<string, unknown> | null // 嵌套 response 对象 (Veo API 实际格式)
            errorMessage: string | null
        }
    }

    const logger = createScopedLogger({ module: 'worker.kieai-video', action: 'kieai_video_poll' })
    const sf = data.data?.successFlag
    logger.info({
        message: 'KieAI video poll response',
        details: {
            taskId,
            successFlag: sf,
            hasResultUrls: !!data.data?.resultUrls,
            hasResponse: !!data.data?.response,
            errorMessage: data.data?.errorMessage,
            // 当 successFlag=1 时记录完整信息以排查
            ...(sf === 1 ? {
                rawDataKeys: Object.keys(data.data || {}),
                responseKeys: data.data?.response ? Object.keys(data.data.response) : [],
                responseData: data.data?.response ? JSON.stringify(data.data.response).slice(0, 1000) : null,
            } : {}),
        },
    })

    switch (data.data?.successFlag) {
        case 1: {
            let videoUrl: string | undefined

            // 方式1: 从 resultUrls 字段解析 (旧版 API 格式)
            if (data.data.resultUrls) {
                try {
                    const urls = JSON.parse(data.data.resultUrls)
                    if (Array.isArray(urls) && urls.length > 0) {
                        videoUrl = urls[0]
                    }
                } catch {
                    videoUrl = data.data.resultUrls
                }
            }

            // 方式2: 从 response 嵌套对象解析 (Veo API 实际格式)
            if (!videoUrl && data.data.response) {
                const resp = data.data.response
                // 尝试 response.resultUrls
                if (typeof resp.resultUrls === 'string') {
                    try {
                        const urls = JSON.parse(resp.resultUrls)
                        if (Array.isArray(urls) && urls.length > 0) {
                            videoUrl = urls[0]
                        }
                    } catch {
                        videoUrl = resp.resultUrls
                    }
                } else if (Array.isArray(resp.resultUrls) && resp.resultUrls.length > 0) {
                    videoUrl = resp.resultUrls[0] as string
                }
                // 尝试 response.videoUrl
                if (!videoUrl && typeof resp.videoUrl === 'string') {
                    videoUrl = resp.videoUrl
                }
                // 尝试 response.result (可能是 URL 或 JSON)
                if (!videoUrl && typeof resp.result === 'string') {
                    if (resp.result.startsWith('http')) {
                        videoUrl = resp.result
                    } else {
                        try {
                            const parsed = JSON.parse(resp.result)
                            if (Array.isArray(parsed) && parsed.length > 0) {
                                videoUrl = parsed[0]
                            } else if (typeof parsed === 'object' && parsed.url) {
                                videoUrl = parsed.url
                            }
                        } catch { /* ignore */ }
                    }
                }
                // 尝试 response.videos
                if (!videoUrl && Array.isArray(resp.videos) && resp.videos.length > 0) {
                    const first = resp.videos[0] as Record<string, unknown>
                    videoUrl = (first?.url || first?.videoUrl || first) as string
                }
            }

            if (!videoUrl) {
                return {
                    status: 'failed',
                    error: 'KieAI: 视频生成完成但未返回视频URL',
                }
            }
            return {
                status: 'completed',
                videoUrl,
            }
        }
        case 2:
            return {
                status: 'failed',
                error: `KieAI: 任务创建失败 ${data.data.errorMessage || ''}`.trim(),
            }
        case 3:
            return {
                status: 'failed',
                error: `KieAI: 视频生成失败 ${data.data.errorMessage || ''}`.trim(),
            }
        case 0:
        default:
            return {
                status: 'pending',
            }
    }
}
