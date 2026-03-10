/**
 * Kie.ai Nano Banana 2 图片生成器
 *
 * 模型：nano-banana-2 (Google Gemini 3.1 Flash Image)
 *
 * API（通用 Jobs 接口，与 Kling 共用）:
 * - 提交: POST https://api.kie.ai/api/v1/jobs/createTask
 * - 轮询: GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId={taskId}
 *
 * state: waiting | generating | success | fail
 *
 * 支持 aspect_ratio:
 *   1:1, 1:4, 1:8, 2:3, 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9, auto
 *
 * 支持 resolution: 1K, 2K, 4K
 */

import { BaseImageGenerator, type GenerateResult, type ImageGenerateParams } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { createScopedLogger } from '@/lib/logging/core'
import { uploadToCOS, generateUniqueKey, getSignedUrl, toFetchableUrl } from '@/lib/cos'

const KIEAI_BASE_URL = 'https://api.kie.ai'

interface KieAINanoBananaOptions {
    aspectRatio?: string
    resolution?: string       // '1K' | '2K' | '4K'
    outputFormat?: string     // 'png' | 'jpg'
}

export class KieAINanoBananaGenerator extends BaseImageGenerator {
    private readonly modelId: string

    constructor(modelId?: string) {
        super()
        this.modelId = modelId || 'nano-banana-2'
    }

    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'kieai')
        const {
            aspectRatio = '1:1',
            resolution = '2K',
            outputFormat,
        } = options as KieAINanoBananaOptions

        const logger = createScopedLogger({
            module: 'worker.kieai-nanobanana',
            action: 'kieai_nanobanana_generate',
        })

        const input: Record<string, unknown> = {
            prompt,
            aspect_ratio: aspectRatio,
            resolution,
        }

        if (outputFormat) {
            input.output_format = outputFormat
        }

        // 支持参考图片（image_input）— 最多 14 张公开 URL
        const imageInputUrls: string[] = []
        for (const ref of referenceImages) {
            if (ref.startsWith('http://') || ref.startsWith('https://')) {
                imageInputUrls.push(ref)
            } else if (ref.startsWith('data:')) {
                try {
                    const base64Match = ref.match(/^data:[^;]+;base64,(.+)$/)
                    if (base64Match) {
                        const buffer = Buffer.from(base64Match[1], 'base64')
                        const tempKey = generateUniqueKey('kieai-nb-ref', 'jpg')
                        await uploadToCOS(buffer, tempKey)
                        const signedUrl = getSignedUrl(tempKey, 3600)
                        const publicUrl = toFetchableUrl(signedUrl)
                        if (publicUrl.startsWith('https://')) {
                            imageInputUrls.push(publicUrl)
                        } else {
                            logger.warn({
                                message: 'KieAI NanoBanana reference image skipped: not accessible externally',
                                details: { urlPrefix: publicUrl.substring(0, 30) },
                            })
                        }
                    }
                } catch (uploadError) {
                    logger.warn({
                        message: 'KieAI NanoBanana reference image upload failed',
                        details: { error: String(uploadError) },
                    })
                }
            }
        }

        if (imageInputUrls.length > 0) {
            input.image_input = imageInputUrls
        }

        const body = {
            model: this.modelId,
            input,
        }

        logger.info({
            message: 'KieAI NanoBanana image generation request',
            details: {
                model: this.modelId,
                aspectRatio,
                resolution,
                hasImageInput: imageInputUrls.length > 0,
                imageInputCount: imageInputUrls.length,
                promptLength: prompt.length,
                prompt: prompt.substring(0, 500),
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
            throw new Error(`KieAI NanoBanana 提交失败 (${response.status}): ${errorText}`)
        }

        const data = await response.json() as {
            code: number
            msg: string
            data: { taskId: string }
        }

        if (data.code !== 200) {
            throw new Error(`KieAI NanoBanana 错误 (code ${data.code}): ${data.msg}`)
        }

        const taskId = data.data?.taskId
        if (!taskId) {
            throw new Error('KieAI NanoBanana 未返回 taskId')
        }

        logger.info({
            message: 'KieAI NanoBanana task submitted',
            details: { taskId },
        })

        return {
            success: true,
            async: true,
            externalId: `KIEAI:NANOBANANA:${taskId}`,
        }
    }
}

/**
 * 查询 Kie.ai NanoBanana 任务状态（通用 Jobs 接口）
 */
export async function queryKieAINanoBananaTaskStatus(
    taskId: string,
    apiKey: string,
): Promise<{ status: 'pending' | 'completed' | 'failed'; imageUrl?: string; error?: string }> {
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
        throw new Error(`KieAI NanoBanana 查询失败 (${response.status}): ${errorText}`)
    }

    const rawText = await response.text()
    let data: {
        code: number
        msg: string
        data: {
            taskId: string
            state: string // waiting | generating | success | fail
            resultJson: string | null
            errorMessage: string | null
        }
    }

    try {
        data = JSON.parse(rawText)
    } catch {
        throw new Error(`KieAI NanoBanana 查询返回非JSON: ${rawText.substring(0, 500)}`)
    }

    const state = data.data?.state
    const logger = createScopedLogger({
        module: 'worker.kieai-nanobanana',
        action: 'kieai_nanobanana_poll',
    })

    switch (state) {
        case 'success': {
            let imageUrl: string | undefined
            try {
                const resultJson = JSON.parse(data.data.resultJson || '{}')
                const resultUrls = typeof resultJson.resultUrls === 'string'
                    ? JSON.parse(resultJson.resultUrls)
                    : resultJson.resultUrls
                if (Array.isArray(resultUrls) && resultUrls.length > 0) {
                    imageUrl = resultUrls[0]
                }
            } catch {
                if (data.data.resultJson) {
                    try {
                        const urls = JSON.parse(data.data.resultJson)
                        if (Array.isArray(urls) && urls.length > 0) {
                            imageUrl = urls[0]
                        }
                    } catch {
                        // ignore
                    }
                }
            }
            return { status: 'completed', imageUrl }
        }
        case 'fail': {
            const errorDetail = data.data.errorMessage || data.msg || '(无错误信息)'
            logger.error({
                message: 'KieAI NanoBanana 生成失败',
                details: {
                    taskId,
                    state,
                    errorMessage: data.data.errorMessage,
                    apiMsg: data.msg,
                    apiCode: data.code,
                    resultJson: data.data.resultJson?.substring(0, 300),
                    rawResponse: rawText.substring(0, 500),
                },
            })
            return {
                status: 'failed',
                error: `KieAI NanoBanana: 生成失败 — ${errorDetail}`,
            }
        }
        case 'waiting':
        case 'generating':
        default:
            return { status: 'pending' }
    }
}
