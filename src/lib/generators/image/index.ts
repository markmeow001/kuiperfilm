/**
 * 图片生成器统一导出
 * 
 * 🔥 FAL 和 Ark 已迁移到根目录的合并文件
 * - FAL: ../fal.ts
 * - Ark: ../ark.ts
 */

// Google 生成器保持原位置
export { GoogleGeminiImageGenerator, GoogleImagenGenerator, GoogleGeminiBatchImageGenerator } from './google'
export { GeminiCompatibleImageGenerator } from './gemini-compatible'
export { OpenAICompatibleImageGenerator } from './openai-compatible'


// KieAI 生成器
export { KieAIImageGenerator } from './kieai'
export { KieAINanoBananaGenerator } from './kieai-nanobanana'

// 騰訊雲 VOD AIGC 生成器
export { TencentVODImageGenerator } from './tencent-vod'

// AtlasCloud image (Phase U, 2026-05-28) — GPT Image 2 + Nano Banana family
export { AtlasCloudImageGenerator } from './atlascloud'

// 向后兼容：从合并文件重新导出
export { FalBananaGenerator, FalImageGenerator } from '../fal'
export { ArkSeedreamGenerator, ArkImageGenerator } from '../ark'
