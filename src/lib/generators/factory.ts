/**
 * 生成器工厂（增强版）
 * 
 * 支持：
 * - 根据 provider 创建生成器
 */

import { ImageGenerator, VideoGenerator, AudioGenerator } from './base'
import { FalBananaGenerator } from './fal'
import { ArkSeedreamGenerator, ArkSeedanceVideoGenerator } from './ark'
import { FalVideoGenerator } from './fal'
import {
    GoogleGeminiImageGenerator,
    GoogleImagenGenerator,
    GoogleGeminiBatchImageGenerator,
    GeminiCompatibleImageGenerator,
    OpenAICompatibleImageGenerator,
    KieAIImageGenerator,
    KieAINanoBananaGenerator,
    TencentVODImageGenerator,
} from './image'
import { GoogleVeoVideoGenerator } from './video/google'
import { OpenAICompatibleVideoGenerator } from './video'
import { QwenTTSGenerator } from './audio'
import { MinimaxVideoGenerator } from './minimax'
import { ViduVideoGenerator } from './vidu'
import { KieAIVideoGenerator } from './video/kieai'
import { KieAIKlingVideoGenerator } from './video/kieai-kling'
import { AtlasCloudSeedanceVideoGenerator } from './video/atlascloud'
import { TencentVODVideoGenerator } from './video/tencent-vod'
import { TaijiaiSeedanceVideoGenerator } from './video/taijiai'
import { getProviderKey } from '@/lib/api-config'

/**
 * 根据 provider 创建图片生成器
 */
export function createImageGenerator(provider: string, modelId?: string): ImageGenerator {
    const normalizeModelId = (rawModelId?: string): string | undefined => {
        if (!rawModelId) return rawModelId
        const delimiterIndex = rawModelId.indexOf('::')
        return delimiterIndex === -1 ? rawModelId : rawModelId.slice(delimiterIndex + 2)
    }

    const actualModelId = normalizeModelId(modelId)
    const providerKey = getProviderKey(provider).toLowerCase()
    switch (providerKey) {
        case 'fal':
            return new FalBananaGenerator()
        case 'google':
            if (actualModelId === 'gemini-3-pro-image-preview-batch') {
                return new GoogleGeminiBatchImageGenerator()
            }
            if (actualModelId && actualModelId.startsWith('imagen-')) {
                return new GoogleImagenGenerator(actualModelId)
            }
            return new GoogleGeminiImageGenerator(actualModelId)
        case 'google-batch':  // 🔥 Gemini Batch 异步模式
            return new GoogleGeminiBatchImageGenerator()
        case 'imagen':
            return new GoogleImagenGenerator(actualModelId)
        case 'ark':
            return new ArkSeedreamGenerator()
        case 'gemini-compatible':
            return new GeminiCompatibleImageGenerator(actualModelId, provider)
        case 'openai-compatible':
            return new OpenAICompatibleImageGenerator(actualModelId, provider)
        case 'kieai':
            if (actualModelId?.startsWith('nano-banana')) {
                return new KieAINanoBananaGenerator(actualModelId)
            }
            return new KieAIImageGenerator(actualModelId)
        case 'tencent-vod':
            return new TencentVODImageGenerator(provider)
        default:
            throw new Error(`Unknown image generator provider: ${provider}`)
    }
}

/**
 * 根据 provider 创建视频生成器
 */
export function createVideoGenerator(provider: string, modelId?: string): VideoGenerator {
    const normalizeModelId = (rawModelId?: string): string | undefined => {
        if (!rawModelId) return rawModelId
        const delimiterIndex = rawModelId.indexOf('::')
        return delimiterIndex === -1 ? rawModelId : rawModelId.slice(delimiterIndex + 2)
    }

    const actualModelId = normalizeModelId(modelId)
    const providerKey = getProviderKey(provider).toLowerCase()
    switch (providerKey) {
        case 'fal':
            return new FalVideoGenerator()
        case 'ark':
            return new ArkSeedanceVideoGenerator()
        case 'google':
            return new GoogleVeoVideoGenerator()
        case 'gemini-compatible':
            return new GoogleVeoVideoGenerator(provider)
        case 'minimax':
            return new MinimaxVideoGenerator()
        case 'vidu':
            return new ViduVideoGenerator()
        case 'openai-compatible':
            return new OpenAICompatibleVideoGenerator(provider)
        case 'kieai':
            if (actualModelId?.startsWith('kling-')) {
                return new KieAIKlingVideoGenerator()
            }
            return new KieAIVideoGenerator()
        case 'kieai-kling':
            return new KieAIKlingVideoGenerator()
        case 'atlascloud':
            return new AtlasCloudSeedanceVideoGenerator()
        case 'tencent-vod':
            return new TencentVODVideoGenerator(provider)
        case 'taijiai':
            return new TaijiaiSeedanceVideoGenerator()
        default:
            throw new Error(`Unknown video generator provider: ${provider}`)
    }
}

/**
 * 创建语音生成器
 */
export function createAudioGenerator(provider: string): AudioGenerator {
    const providerKey = getProviderKey(provider).toLowerCase()
    switch (providerKey) {
        case 'qwen':
            return new QwenTTSGenerator()
        default:
            throw new Error(`Unknown audio generator provider: ${provider}`)
    }
}
