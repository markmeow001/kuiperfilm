/**
 * Style profile preset catalog.
 *
 * 4 个内建 preset 对应 NovelPromotionProject.artStyle 的常用值：
 * - realistic
 * - american-comic（既有 schema default）
 * - anime
 * - thick-paint
 *
 * 每个 preset 提供 positivePrompt + negativePrompt。
 * Migration script 会用 preset.positivePrompt + 既有 artStylePrompt 组成 stylePositivePrompt。
 */

export type PresetKey = 'realistic' | 'american-comic' | 'anime' | 'thick-paint'

export interface StylePresetEntry {
  label: string
  positivePrompt: string
  negativePrompt: string
}

export const STYLE_PROFILE_PRESETS: Record<PresetKey, StylePresetEntry> = {
  'realistic': {
    label: 'Realistic',
    positivePrompt:
      'photorealistic style, natural lighting, sharp focus, detailed skin texture, real-world physics, accurate proportions, cinematic color grading',
    negativePrompt:
      'cartoon, anime, illustration, painted, low resolution, plastic skin, deformed face, extra limbs, watermark, text overlay',
  },
  'american-comic': {
    label: 'American Comic',
    positivePrompt:
      'american comic book style, bold ink outlines, flat saturated colors, halftone shading, dynamic action poses, dramatic lighting, hero proportions',
    negativePrompt:
      'photo, photorealistic, soft watercolor, blurry edges, muted pastel palette, low contrast, low resolution, watermark, text overlay',
  },
  'anime': {
    label: 'Anime',
    positivePrompt:
      'anime style, clean cel shading, vibrant saturated colors, expressive large eyes, detailed hair strands, soft gradient skin, key light highlights',
    negativePrompt:
      'photo, photorealistic, western comic ink, gritty texture, deformed face, extra fingers, low quality, blurry, watermark, text overlay',
  },
  'thick-paint': {
    label: 'Thick Paint',
    positivePrompt:
      'thick impasto oil painting style, visible brush strokes, rich painterly texture, layered pigments, warm dramatic lighting, classical composition',
    negativePrompt:
      'photo, photorealistic, flat vector, sharp digital edges, pixel art, low resolution, blurry, watermark, text overlay',
  },
}
