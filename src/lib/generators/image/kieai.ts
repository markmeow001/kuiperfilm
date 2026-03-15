/**
 * Kie.ai Flux Kontext 图片生成器
 *
 * 模型：
 * - flux-kontext-pro (默认)
 * - flux-kontext-max
 *
 * API:
 * - 提交: POST https://api.kie.ai/api/v1/flux/kontext/generate
 * - 轮询: GET  https://api.kie.ai/api/v1/flux/kontext/record-info?taskId={taskId}
 *
 * successFlag: 0=generating, 1=success, 2=create_failed, 3=generate_failed
 */

import { BaseImageGenerator, type GenerateResult, type ImageGenerateParams } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { createScopedLogger } from '@/lib/logging/core'
import { uploadToCOS, generateUniqueKey, getSignedUrl, toFetchableUrl } from '@/lib/cos'

const KIEAI_BASE_URL = 'https://api.kie.ai'

/**
 * 将 aspectRatio 字符串映射为 Kie.ai 支持的格式
 * 支持: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16
 * 不支持的比例映射到最接近的支持值
 */
const KIEAI_SUPPORTED_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
const KIEAI_RATIO_FALLBACK: Record<string, string> = {
    '3:2': '4:3',
    '2:3': '3:4',
    '5:4': '4:3',
    '4:5': '3:4',
    '2:1': '16:9',
    '1:2': '9:16',
    '9:21': '9:16',
}

function normalizeAspectRatio(aspectRatio?: string): string {
    if (!aspectRatio) return '1:1'
    if (KIEAI_SUPPORTED_RATIOS.has(aspectRatio)) return aspectRatio
    if (KIEAI_RATIO_FALLBACK[aspectRatio]) return KIEAI_RATIO_FALLBACK[aspectRatio]
    return '1:1'
}

export class KieAIImageGenerator extends BaseImageGenerator {
    private readonly modelId: string

    constructor(modelId?: string) {
        super()
        this.modelId = modelId || 'flux-kontext-pro'
    }

    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'kieai')
        const { aspectRatio } = options as { aspectRatio?: string }

        const logger = createScopedLogger({
            module: 'worker.kieai-image',
            action: 'kieai_image_generate',
        })

        const body: Record<string, unknown> = {
            prompt,
            model: this.modelId,
            aspectRatio: normalizeAspectRatio(aspectRatio),
            safetyTolerance: 6,
        }

        // 支持参考图片（inputImage）— KieAI 仅接受公开可访问的 URL
        if (referenceImages.length > 0) {
            const ref = referenceImages[0]
            if (ref.startsWith('http://') || ref.startsWith('https://')) {
                body.inputImage = ref
            } else if (ref.startsWith('data:')) {
                // base64 data URI → 上传到 COS 获取公开 URL
                try {
                    const base64Match = ref.match(/^data:[^;]+;base64,(.+)$/)
                    if (base64Match) {
                        const buffer = Buffer.from(base64Match[1], 'base64')
                        const tempKey = generateUniqueKey('kieai-ref', 'jpg')
                        await uploadToCOS(buffer, tempKey)
                        const signedUrl = getSignedUrl(tempKey, 3600)
                        const publicUrl = toFetchableUrl(signedUrl)
                        if (publicUrl.startsWith('https://')) {
                            body.inputImage = publicUrl
                        } else {
                            logger.warn({
                                message: 'KieAI reference image skipped: local storage mode, image URL not accessible from external API. Configure COS cloud storage to enable character reference images.',
                                details: { urlPrefix: publicUrl.substring(0, 30) },
                            })
                        }
                    }
                } catch (uploadError) {
                    logger.warn({
                        message: 'KieAI reference image upload failed',
                        details: { error: String(uploadError) },
                    })
                }
            }
        }

        logger.info({
            message: 'KieAI image generation request',
            details: {
                model: this.modelId,
                aspectRatio: body.aspectRatio,
                hasInputImage: !!body.inputImage,
                referenceImagesSkipped: referenceImages.length > 0 && !body.inputImage,
                promptLength: prompt.length,
            },
        })

        const response = await fetch(`${KIEAI_BASE_URL}/api/v1/flux/kontext/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`KieAI 提交失败 (${response.status}): ${errorText}`)
        }

        const data = await response.json() as {
            code: number
            msg: string
            data: { taskId: string }
        }

        if (data.code !== 200) {
            throw new Error(`KieAI 错误 (code ${data.code}): ${data.msg}`)
        }

        const taskId = data.data?.taskId
        if (!taskId) {
            throw new Error('KieAI 未返回 taskId')
        }

        logger.info({
            message: 'KieAI task submitted',
            details: { taskId },
        })

        return {
            success: true,
            async: true,
            externalId: `KIEAI:IMAGE:${taskId}`,
        }
    }
}

/**
 * 查询 Kie.ai 任务状态（供 async-poll 调用）
 */
export async function queryKieAITaskStatus(
    taskId: string,
    apiKey: string,
): Promise<{ status: 'pending' | 'completed' | 'failed'; imageUrl?: string; error?: string }> {
    const response = await fetch(
        `${KIEAI_BASE_URL}/api/v1/flux/kontext/record-info?taskId=${encodeURIComponent(taskId)}`,
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
        },
    )

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`KieAI 查询失败 (${response.status}): ${errorText}`)
    }

    const data = await response.json() as {
        code: number
        msg: string
        data: {
            taskId: string
            successFlag: number // 0=generating, 1=success, 2=create_failed, 3=generate_failed
            response: { originImageUrl: string | null; resultImageUrl: string | null } | null
            errorMessage: string | null
        }
    }

    switch (data.data?.successFlag) {
        case 1: {
            const imageUrl = data.data.response?.resultImageUrl || undefined
            return {
                status: 'completed',
                imageUrl,
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
                error: `KieAI: 图片生成失败 ${data.data.errorMessage || ''}`.trim(),
            }
        case 0:
        default:
            return {
                status: 'pending',
            }
    }
}
