/**
 * API 配置类型定义和预设常量
 */
import {
    composeModelKey,
    parseModelKeyStrict,
    type ModelCapabilities,
    type UnifiedModelType,
} from '@/lib/model-config-contract'

// 统一提供商接口
export interface Provider {
    id: string
    name: string
    baseUrl?: string
    apiKey?: string
    hasApiKey?: boolean
    apiMode?: 'gemini-sdk' | 'openai-official'
    // 2026-05-22 — 火山方舟 asset API credentials (id='ark' only).
    // Separate from apiKey because asset API uses AK/SK + HMAC, not Bearer.
    // accessKeyId is plaintext (not a secret); secretAccessKey gets
    // encrypted on the way to DB same as apiKey. assetGroupId is
    // auto-populated by register-ark-asset worker on first use.
    accessKeyId?: string
    secretAccessKey?: string
    hasSecretAccessKey?: boolean
    assetGroupId?: string
}

export interface LlmCustomPricing {
    inputPerMillion?: number
    outputPerMillion?: number
}

export interface MediaCustomPricing {
    basePrice?: number
    optionPrices?: Record<string, Record<string, number>>
}

// 用户自定义定价 V2（能力参数可定价）
export interface CustomModelPricing {
    llm?: LlmCustomPricing
    image?: MediaCustomPricing
    video?: MediaCustomPricing
}

// 模型接口
export interface CustomModel {
    modelId: string       // 唯一标识符（如 anthropic/claude-sonnet-4.5）
    modelKey: string      // 唯一主键（provider::modelId）
    name: string          // 显示名称
    type: UnifiedModelType
    provider: string
    price: number
    priceMin?: number
    priceMax?: number
    priceLabel?: string
    priceInput?: number
    priceOutput?: number
    enabled: boolean
    capabilities?: ModelCapabilities
    customPricing?: CustomModelPricing
}

export interface PricingDisplayItem {
    min: number
    max: number
    label: string
    input?: number
    output?: number
}

export type PricingDisplayMap = Record<string, PricingDisplayItem>

// API 配置响应
export interface ApiConfig {
    models: CustomModel[]
    providers: Provider[]
    pricingDisplay?: PricingDisplayMap
}

type PresetModel = Omit<CustomModel, 'enabled' | 'modelKey' | 'price'>

// 预设模型
export const PRESET_MODELS: PresetModel[] = [
    // 文本模型
    { modelId: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', type: 'llm', provider: 'openrouter' },
    { modelId: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', type: 'llm', provider: 'openrouter' },
    { modelId: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', type: 'llm', provider: 'openrouter' },
    { modelId: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', type: 'llm', provider: 'openrouter' },
    { modelId: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', type: 'llm', provider: 'openrouter' },
    // Google AI Studio 文本模型
    { modelId: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', type: 'llm', provider: 'google' },
    { modelId: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', type: 'llm', provider: 'google' },
    { modelId: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', type: 'llm', provider: 'google' },
    // 火山引擎 Doubao 文本模型
    { modelId: 'doubao-seed-1-8-251228', name: 'Doubao Seed 1.8', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-2-0-pro-260215', name: 'Doubao Seed 2.0 Pro', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-2-0-lite-260215', name: 'Doubao Seed 2.0 Lite', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-2-0-mini-260215', name: 'Doubao Seed 2.0 Mini', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-1-6-251015', name: 'Doubao Seed 1.6', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-1-6-lite-251015', name: 'Doubao Seed 1.6 Lite', type: 'llm', provider: 'ark' },

    // 图像模型
    { modelId: 'banana', name: 'Banana Pro', type: 'image', provider: 'fal' },
    { modelId: 'banana-2', name: 'Banana 2', type: 'image', provider: 'fal' },
    { modelId: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5', type: 'image', provider: 'ark' },
    { modelId: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0', type: 'image', provider: 'ark' },
    { modelId: 'gemini-3-pro-image-preview', name: 'Banana Pro', type: 'image', provider: 'google' },
    { modelId: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2', type: 'image', provider: 'google' },
    { modelId: 'gemini-3-pro-image-preview-batch', name: 'Banana Pro (Batch)', type: 'image', provider: 'google' },
    { modelId: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', type: 'image', provider: 'google' },
    { modelId: 'imagen-4.0-generate-001', name: 'Imagen 4', type: 'image', provider: 'google' },
    { modelId: 'imagen-4.0-ultra-generate-001', name: 'Imagen 4 Ultra', type: 'image', provider: 'google' },
    { modelId: 'imagen-4.0-fast-generate-001', name: 'Imagen 4 Fast', type: 'image', provider: 'google' },
    // Phase U (2026-05-28) — AtlasCloud 图像模型。AtlasCloud 用 Google 内部
    // 代号 "nano-banana"，对应它们 UI 的 "Gemini 3 X Image" 命名。我们用
    // 真实 API slug 作为 canonical id，picker 显示 user 友善标签。
    { modelId: 'nano-banana-pro', name: 'Gemini 3 Pro Image (AtlasCloud · 推薦)', type: 'image', provider: 'atlascloud' },
    { modelId: 'nano-banana', name: 'Gemini 3 Flash Image (AtlasCloud · 快速)', type: 'image', provider: 'atlascloud' },
    { modelId: 'nano-banana-2', name: 'Gemini 3.1 Flash Image (AtlasCloud · 經濟)', type: 'image', provider: 'atlascloud' },
    { modelId: 'gpt-image-2', name: 'GPT Image 2 (AtlasCloud · OpenAI 按 token 計費)', type: 'image', provider: 'atlascloud' },
    // 视频模型
    { modelId: 'doubao-seedance-1-0-pro-fast-251015', name: 'Seedance 1.0 Pro Fast', type: 'video', provider: 'ark' },
    { modelId: 'doubao-seedance-1-0-lite-i2v-250428', name: 'Seedance 1.0 Lite', type: 'video', provider: 'ark' },
    { modelId: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro', type: 'video', provider: 'ark' },
    // 2026-05-22 — Seedance 2.0 火山直连 (ARK) 接入. 帐户余额 ≥ 200元 才能开通,
    // 音畫同生 (native dialogue+SFX+BGM via generate_audio=true), 多模态 content[]
    // 支持 image+video+audio 参考. 详见 src/lib/generators/ark.ts ARK_SEEDANCE_MODEL_SPECS.
    { modelId: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0 (火山 ARK · audio)', type: 'video', provider: 'ark' },
    { modelId: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast (火山 ARK · audio, no 1080p)', type: 'video', provider: 'ark' },
    // BobAPI / taijiai 中转 — 保留作为火山 ARK 没设额度时的备援.
    { modelId: 'seedance-2.0-720p', name: 'Seedance 2.0 (720p · BobAPI)', type: 'video', provider: 'taijiai' },
    { modelId: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro', type: 'video', provider: 'ark' },
    // Google Veo
    { modelId: 'veo-3.1-generate-preview', name: 'Veo 3.1', type: 'video', provider: 'google' },
    { modelId: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 Fast', type: 'video', provider: 'google' },
    { modelId: 'veo-3.0-generate-001', name: 'Veo 3.0', type: 'video', provider: 'google' },
    { modelId: 'veo-3.0-fast-generate-001', name: 'Veo 3.0 Fast', type: 'video', provider: 'google' },
    { modelId: 'veo-2.0-generate-001', name: 'Veo 2.0', type: 'video', provider: 'google' },
    { modelId: 'fal-wan25', name: 'Wan 2.6', type: 'video', provider: 'fal' },
    { modelId: 'fal-veo31', name: 'Veo 3.1', type: 'video', provider: 'fal' },
    { modelId: 'fal-sora2', name: 'Sora 2', type: 'video', provider: 'fal' },
    { modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', name: 'Kling 2.5 Turbo Pro', type: 'video', provider: 'fal' },
    { modelId: 'fal-ai/kling-video/v3/standard/image-to-video', name: 'Kling 3 Standard', type: 'video', provider: 'fal' },
    { modelId: 'fal-ai/kling-video/v3/pro/image-to-video', name: 'Kling 3 Pro', type: 'video', provider: 'fal' },
    // 2026-05-16 — Seedance 2.0 on fal (BobAPI 备援)。standard + fast 两版。
    // 2026-05-21 Phase D — added r2v variants for full multi-shot vendor parity.
    { modelId: 'bytedance/seedance-2.0/image-to-video', name: 'Seedance 2.0 I2V (fal · audio)', type: 'video', provider: 'fal' },
    { modelId: 'bytedance/seedance-2.0/reference-to-video', name: 'Seedance 2.0 R2V (fal · 9-ref)', type: 'video', provider: 'fal' },
    { modelId: 'bytedance/seedance-2.0/fast/image-to-video', name: 'Seedance 2.0 Fast I2V (fal · cheap)', type: 'video', provider: 'fal' },
    { modelId: 'bytedance/seedance-2.0/fast/reference-to-video', name: 'Seedance 2.0 Fast R2V (fal · 9-ref cheap)', type: 'video', provider: 'fal' },

    // 音频模型
    { modelId: 'fal-ai/index-tts-2/text-to-speech', name: 'IndexTTS 2', type: 'audio', provider: 'fal' },
    // 口型同步模型
    { modelId: 'fal-ai/kling-video/lipsync/audio-to-video', name: 'Kling Lip Sync', type: 'lipsync', provider: 'fal' },
    { modelId: 'vidu-lipsync', name: 'Vidu Lip Sync', type: 'lipsync', provider: 'vidu' },

    // MiniMax 视频模型
    { modelId: 'minimax-hailuo-2.3', name: 'Hailuo 2.3', type: 'video', provider: 'minimax' },
    { modelId: 'minimax-hailuo-2.3-fast', name: 'Hailuo 2.3 Fast', type: 'video', provider: 'minimax' },
    { modelId: 'minimax-hailuo-02', name: 'Hailuo 02', type: 'video', provider: 'minimax' },
    { modelId: 't2v-01', name: 'T2V-01', type: 'video', provider: 'minimax' },
    { modelId: 't2v-01-director', name: 'T2V-01 Director', type: 'video', provider: 'minimax' },

    // AtlasCloud 视频模型
    { modelId: 'seedance-v1.5-pro', name: 'Seedance v1.5 Pro', type: 'video', provider: 'atlascloud' },
    { modelId: 'wan-2.6', name: 'Wan 2.6 Flash', type: 'video', provider: 'atlascloud' },
    // 2026-05-20 — AtlasCloud Seedance 2.0（6 變體：t2v / i2v / r2v × standard / fast，
    // 原生 audio，480p/720p/1080p，4-15s，multi-shot 由 prompt 編碼）
    { modelId: 'seedance-2.0-t2v', name: 'Seedance 2.0 T2V (AtlasCloud · audio)', type: 'video', provider: 'atlascloud' },
    { modelId: 'seedance-2.0-i2v', name: 'Seedance 2.0 I2V (AtlasCloud · audio)', type: 'video', provider: 'atlascloud' },
    { modelId: 'seedance-2.0-r2v', name: 'Seedance 2.0 R2V (AtlasCloud · 9-ref)', type: 'video', provider: 'atlascloud' },
    { modelId: 'seedance-2.0-fast-t2v', name: 'Seedance 2.0 Fast T2V (AtlasCloud · audio)', type: 'video', provider: 'atlascloud' },
    { modelId: 'seedance-2.0-fast-i2v', name: 'Seedance 2.0 Fast I2V (AtlasCloud · audio)', type: 'video', provider: 'atlascloud' },
    { modelId: 'seedance-2.0-fast-r2v', name: 'Seedance 2.0 Fast R2V (AtlasCloud · 9-ref cheap)', type: 'video', provider: 'atlascloud' },

    // Vidu 视频模型
    { modelId: 'viduq3-pro', name: 'Vidu Q3 Pro', type: 'video', provider: 'vidu' },
    { modelId: 'viduq2-pro-fast', name: 'Vidu Q2 Pro Fast', type: 'video', provider: 'vidu' },
    { modelId: 'viduq2-pro', name: 'Vidu Q2 Pro', type: 'video', provider: 'vidu' },
    { modelId: 'viduq2-turbo', name: 'Vidu Q2 Turbo', type: 'video', provider: 'vidu' },
    { modelId: 'viduq1', name: 'Vidu Q1', type: 'video', provider: 'vidu' },
    { modelId: 'viduq1-classic', name: 'Vidu Q1 Classic', type: 'video', provider: 'vidu' },
    { modelId: 'vidu2.0', name: 'Vidu 2.0', type: 'video', provider: 'vidu' },

    // Tencent Cloud VOD AIGC — auto-generated from
    // standards/capabilities/image-video.catalog.json so the UI lists
    // them by default once the user has filled SecretId/SecretKey/SubAppId.
    { modelId: 'Kling-1.6', name: 'Kling-1.6', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Kling-2.0', name: 'Kling-2.0', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Kling-2.1', name: 'Kling-2.1', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Kling-2.5', name: 'Kling-2.5', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Kling-2.6', name: 'Kling-2.6', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Kling-O1', name: 'Kling-O1', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Kling-3.0', name: 'Kling-3.0', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Kling-3.0-Omni', name: 'Kling-3.0-Omni', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Vidu-q2', name: 'Vidu-q2 (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Vidu-q2-pro', name: 'Vidu-q2-pro (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Vidu-q2-turbo', name: 'Vidu-q2-turbo (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Vidu-q3', name: 'Vidu-q3 (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Vidu-q3-pro', name: 'Vidu-q3-pro (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Vidu-q3-mix', name: 'Vidu-q3-mix (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Vidu-q3-turbo', name: 'Vidu-q3-turbo (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Hailuo-02', name: 'Hailuo-02', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Hailuo-2.3', name: 'Hailuo-2.3', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Hailuo-2.3-fast', name: 'Hailuo-2.3-fast', type: 'video', provider: 'tencent-vod' },
    { modelId: 'PixVerse-v5.6', name: 'PixVerse-v5.6', type: 'video', provider: 'tencent-vod' },
    { modelId: 'PixVerse-v6', name: 'PixVerse-v6', type: 'video', provider: 'tencent-vod' },
    { modelId: 'PixVerse-c1', name: 'PixVerse-c1', type: 'video', provider: 'tencent-vod' },
    { modelId: 'GV-3.1', name: 'GV-3.1', type: 'video', provider: 'tencent-vod' },
    { modelId: 'GV-3.1-fast', name: 'GV-3.1-fast', type: 'video', provider: 'tencent-vod' },
    { modelId: 'OS-2.0', name: 'OS-2.0', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Seedance-1.0-pro', name: 'Seedance-1.0-pro (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Seedance-1.0-lite-i2v', name: 'Seedance-1.0-lite-i2v (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Seedance-1.0-pro-fast', name: 'Seedance-1.0-pro-fast (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Seedance-1.5-pro', name: 'Seedance-1.5-pro (Tencent)', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Jimeng-3.0pro', name: 'Jimeng-3.0pro', type: 'video', provider: 'tencent-vod' },
    { modelId: 'Hunyuan-1.5', name: 'Hunyuan-1.5', type: 'video', provider: 'tencent-vod' },
    { modelId: 'GEM-2.5', name: 'GEM-2.5', type: 'image', provider: 'tencent-vod' },
    { modelId: 'GEM-3.0', name: 'GEM-3.0', type: 'image', provider: 'tencent-vod' },
    { modelId: 'GEM-3.1', name: 'GEM-3.1', type: 'image', provider: 'tencent-vod' },
    { modelId: 'OG-image2_low', name: 'OG-image2_low', type: 'image', provider: 'tencent-vod' },
    { modelId: 'OG-image2_medium', name: 'OG-image2_medium', type: 'image', provider: 'tencent-vod' },
    { modelId: 'OG-image2_high', name: 'OG-image2_high', type: 'image', provider: 'tencent-vod' },
    { modelId: 'Qwen-0925', name: 'Qwen-0925 (Tencent)', type: 'image', provider: 'tencent-vod' },
    { modelId: 'SI-4.5', name: 'SI-4.5', type: 'image', provider: 'tencent-vod' },
    { modelId: 'SI-5.0-lite', name: 'SI-5.0-lite', type: 'image', provider: 'tencent-vod' },
    { modelId: 'Kling-2.1', name: 'Kling-2.1 (Image, 4 refs)', type: 'image', provider: 'tencent-vod' },
    { modelId: 'Kling-3.0', name: 'Kling-3.0 (Image, 1 ref)', type: 'image', provider: 'tencent-vod' },
    { modelId: 'Kling-3.0-Omni', name: 'Kling-3.0-Omni (Image, 10 refs)', type: 'image', provider: 'tencent-vod' },
    { modelId: 'Kling-O1', name: 'Kling-O1 (Image, 10 refs)', type: 'image', provider: 'tencent-vod' },
    { modelId: 'Vidu-q2', name: 'Vidu-q2 (Image)', type: 'image', provider: 'tencent-vod' },
    { modelId: 'Jimeng-4.0', name: 'Jimeng-4.0', type: 'image', provider: 'tencent-vod' },
    { modelId: 'Hunyuan-3.0', name: 'Hunyuan-3.0', type: 'image', provider: 'tencent-vod' },
]

const PRESET_COMING_SOON_MODEL_KEYS = new Set<string>([
    // 2026-05-22 — Seedance 2.0 火山 ARK 直连 已激活 (账户余额 ≥ 200元 即可开通).
    // 之前留 placeholder 时挂在 coming-soon, 现已移除.
])

export function isPresetComingSoonModel(provider: string, modelId: string): boolean {
    return PRESET_COMING_SOON_MODEL_KEYS.has(encodeModelKey(provider, modelId))
}

export function isPresetComingSoonModelKey(modelKey: string): boolean {
    return PRESET_COMING_SOON_MODEL_KEYS.has(modelKey)
}

// 预设提供商（API Key 唯一归属于 provider id）
export const PRESET_PROVIDERS: Omit<Provider, 'apiKey' | 'hasApiKey'>[] = [
    { id: 'tencent-vod', name: 'Tencent Cloud VOD AIGC', baseUrl: 'https://vod.tencentcloudapi.com' },
    { id: 'tencent-hunyuan', name: 'Tencent Hunyuan', baseUrl: 'https://hunyuan.tencentcloudapi.com' },
    { id: 'ark', name: 'Volcengine Ark' },
    { id: 'google', name: 'Google AI Studio' },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
    { id: 'minimax', name: 'MiniMax Hailuo' },
    { id: 'vidu', name: 'Vidu' },
    { id: 'fal', name: 'FAL' },
    { id: 'qwen', name: 'Qwen' },
    { id: 'atlascloud', name: 'AtlasCloud' },
    // BobAPI / taijiai.online — Seedance 2.0 reseller (字节跳动 source,
    // repackaged as @N content[] multi-modal references).
    { id: 'taijiai', name: 'BobAPI (Seedance 2.0)', baseUrl: 'https://www.taijiai.online' },
]

const ZH_PROVIDER_NAME_MAP: Record<string, string> = {
    'tencent-vod': '騰訊雲 VOD AIGC',
    'tencent-hunyuan': '騰訊混元',
    ark: '火山引擎 Ark',
    minimax: '海螺 MiniMax',
    vidu: '生数科技 Vidu',
    taijiai: 'BobAPI 中转站（Seedance 2.0）',
}

function isZhLocale(locale?: string): boolean {
    return typeof locale === 'string' && locale.toLowerCase().startsWith('zh')
}

export function resolvePresetProviderName(providerId: string, fallbackName: string, locale?: string): string {
    if (!isZhLocale(locale)) return fallbackName
    return ZH_PROVIDER_NAME_MAP[providerId] ?? fallbackName
}

/**
 * 提取提供商主键（用于多实例场景，如 gemini-compatible:uuid）
 */
export function getProviderKey(providerId?: string): string {
    if (!providerId) return ''
    const colonIndex = providerId.indexOf(':')
    return colonIndex === -1 ? providerId : providerId.slice(0, colonIndex)
}

/**
 * 获取厂商的友好显示名称
 * @param providerId - 厂商ID（如 'ark', 'google'）
 * @returns 友好名称（如 '火山引擎(方舟)', 'Google AI Studio'）
 */
export function getProviderDisplayName(providerId?: string, locale?: string): string {
    if (!providerId) return ''
    const providerKey = getProviderKey(providerId)
    const provider = PRESET_PROVIDERS.find(p => p.id === providerKey)
    if (!provider) return providerId
    return resolvePresetProviderName(provider.id, provider.name, locale)
}

/**
 * 编码模型复合 Key（用于区分同名模型）
 * @param provider - 厂商 ID
 * @param modelId - 模型 ID
 * @returns 复合 Key，格式为 `provider::modelId`（使用双冒号避免与 provider ID 中的冒号冲突）
 */
export function encodeModelKey(provider: string, modelId: string): string {
    return composeModelKey(provider, modelId)
}

/**
 * 解析模型复合 Key
 * @param key - 复合 Key（provider::modelId）
 * @returns 解析后的 { provider, modelId }，如果无法解析返回 null
 */
export function parseModelKey(key: string | undefined | null): { provider: string, modelId: string } | null {
    const parsed = parseModelKeyStrict(key)
    if (!parsed) return null
    return {
        provider: parsed.provider,
        modelId: parsed.modelId,
    }
}

/**
 * 检查一个复合 Key 是否匹配指定的模型
 * @param key - 复合 Key（provider::modelId）
 * @param provider - 目标厂商 ID
 * @param modelId - 目标模型 ID
 * @returns 是否匹配
 */
export function matchesModelKey(key: string | undefined | null, provider: string, modelId: string): boolean {
    const parsed = parseModelKeyStrict(key)
    if (!parsed) return false
    return parsed.provider === provider && parsed.modelId === modelId
}

// 教程步骤接口
export interface TutorialStep {
    text: string           // 步骤描述 (i18n key)
    url?: string           // 可选的链接地址
}

// 厂商教程接口
export interface ProviderTutorial {
    providerId: string
    steps: TutorialStep[]
}

// 厂商开通教程配置
// 注意: text 字段使用 i18n key, 翻译在 apiConfig.tutorials 下
export const PROVIDER_TUTORIALS: ProviderTutorial[] = [
    {
        providerId: 'ark',
        steps: [
            {
                text: 'ark_step1',
                url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D'
            },
            {
                text: 'ark_step2',
                url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model'
            }
        ]
    },
    {
        providerId: 'openrouter',
        steps: [
            {
                text: 'openrouter_step1',
                url: 'https://openrouter.ai/settings/keys'
            }
        ]
    },
    {
        providerId: 'fal',
        steps: [
            {
                text: 'fal_step1',
                url: 'https://fal.ai/dashboard/keys'
            }
        ]
    },
    {
        providerId: 'google',
        steps: [
            {
                text: 'google_step1',
                url: 'https://aistudio.google.com/api-keys'
            }
        ]
    },
    {
        providerId: 'minimax',
        steps: [
            {
                text: 'minimax_step1',
                url: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
            }
        ]
    },
    {
        providerId: 'vidu',
        steps: [
            {
                text: 'vidu_step1',
                url: 'https://platform.vidu.cn/api-keys'
            }
        ]
    },
    {
        providerId: 'gemini-compatible',
        steps: [
            {
                text: 'gemini_compatible_step1'
            }
        ]
    },
    {
        providerId: 'openai-compatible',
        steps: [
            {
                text: 'openai_compatible_step1'
            }
        ]
    },
    {
        providerId: 'qwen',
        steps: [
            {
                text: 'qwen_step1',
                url: 'https://bailian.console.aliyun.com/cn-beijing/?tab=model#/api-key'
            }
        ]
    },
    {
        providerId: 'atlascloud',
        steps: [
            {
                text: 'atlascloud_step1',
                url: 'https://www.atlascloud.ai/zh-TW/console/api-keys'
            }
        ]
    },
    {
        providerId: 'taijiai',
        steps: [
            {
                text: 'taijiai_step1',
                url: 'https://www.taijiai.online/register'
            },
            {
                text: 'taijiai_step2',
                url: 'https://www.taijiai.online/login'
            }
        ]
    }
]

/**
 * 根据厂商ID获取教程配置
 * @param providerId - 厂商ID
 * @returns 教程配置，如果不存在则返回 undefined
 */
export function getProviderTutorial(providerId: string): ProviderTutorial | undefined {
    const providerKey = getProviderKey(providerId)
    return PROVIDER_TUTORIALS.find(t => t.providerId === providerKey)
}

/**
 * 获取 Google 官方模型列表的克隆副本，provider 替换为指定 ID。
 * 用于 gemini-compatible 新增时自动预设模型。
 * 排除 batch 模型（Google 特有的异步批量处理）。
 */
export function getGoogleCompatiblePresetModels(providerId: string): PresetModel[] {
    return PRESET_MODELS
        .filter((m) => m.provider === 'google' && !m.modelId.endsWith('-batch'))
        .map((m) => ({ ...m, provider: providerId }))
}
