// ============================================================
// AI 短劇平台 — 光影預設庫 Seed Data (8 個)
// ============================================================
// 對應文檔: style-library-design-v3.md (第三部分)
// ============================================================

import type { LightingPreset } from './02-types';

export const lightingPresets: LightingPreset[] = [
  {
    id: 'golden_hour',
    nameZh: '黃金時刻',
    nameEn: 'Golden Hour',
    thumbnailUrl: null,
    lightingOverride:
      'golden hour sunset lighting, warm amber and rose tones, long soft shadows, backlit characters with rim light, hazy atmospheric warmth, sun flares through hair',
    additionalNegative: 'harsh midday sun, blue cold lighting, overcast',
    bestForMoods: ['romantic', 'nostalgic', 'hopeful'],
    tags: ['warm', 'soft', 'natural'],
    displayOrder: 1,
    isActive: true,
  },
  {
    id: 'blue_hour',
    nameZh: '藍調黎明',
    nameEn: 'Blue Hour Dawn',
    thumbnailUrl: null,
    lightingOverride:
      'blue hour pre-dawn lighting, deep blue sky with subtle warm horizon, cool ambient tone, mysterious soft glow, mist hanging in air',
    additionalNegative: 'warm sunset, bright daylight, neon',
    bestForMoods: ['melancholic', 'mysterious', 'contemplative'],
    tags: ['cool', 'soft', 'natural'],
    displayOrder: 2,
    isActive: true,
  },
  {
    id: 'dramatic_high_contrast',
    nameZh: '戲劇高對比',
    nameEn: 'Dramatic High Contrast',
    thumbnailUrl: null,
    lightingOverride:
      'high contrast dramatic lighting, deep shadows with selective bright highlights, single hard key light source, Caravaggio chiaroscuro, mysterious atmosphere with most frame in shadow',
    additionalNegative: 'flat lighting, soft diffused, evenly lit, daytime',
    bestForMoods: ['tense', 'noir', 'confrontational'],
    tags: ['dark', 'intense', 'moody'],
    displayOrder: 3,
    isActive: true,
  },
  {
    id: 'rainy_neon_night',
    nameZh: '雨夜霓虹',
    nameEn: 'Rainy Neon Night',
    thumbnailUrl: null,
    lightingOverride:
      'rain-soaked night street lighting, neon signage reflections on wet asphalt, magenta and cyan accent lights, light haze from rain, dramatic urban nighttime',
    additionalNegative: 'daytime, dry weather, rural, soft natural light',
    bestForMoods: ['noir romance', 'thriller', 'urban melancholy'],
    tags: ['dark', 'neon', 'urban', 'wet'],
    displayOrder: 4,
    isActive: true,
  },
  {
    id: 'soft_window_light',
    nameZh: '柔和窗光',
    nameEn: 'Soft Window Light',
    thumbnailUrl: null,
    lightingOverride:
      'soft diffused window light, indoor natural lighting, gentle wraparound illumination, subtle window frame shadow patterns, intimate domestic atmosphere',
    additionalNegative: 'harsh shadows, outdoor harsh sun, neon, dramatic',
    bestForMoods: ['intimate', 'tender', 'domestic'],
    tags: ['soft', 'warm', 'intimate'],
    displayOrder: 5,
    isActive: true,
  },
  {
    id: 'moonlight_cool',
    nameZh: '月光冷調',
    nameEn: 'Moonlight Cool',
    thumbnailUrl: null,
    lightingOverride:
      'cool moonlight illumination, silver-blue ambient tone, hard shadows from above, dreamy ethereal nighttime atmosphere, slight mist',
    additionalNegative: 'warm lighting, daytime, neon, indoor',
    bestForMoods: ['romantic', 'mysterious', 'fantasy'],
    tags: ['cool', 'soft', 'night', 'natural'],
    displayOrder: 6,
    isActive: true,
  },
  {
    id: 'fluorescent_cold',
    nameZh: '螢光燈冷光',
    nameEn: 'Fluorescent Cold',
    thumbnailUrl: null,
    lightingOverride:
      'cold fluorescent overhead lighting, flat sterile illumination, slight green-cyan color cast, office or hospital atmosphere, unflattering top-down light',
    additionalNegative: 'warm cozy, golden hour, intimate lighting, candlelight',
    bestForMoods: ['clinical', 'tense', 'interrogation'],
    tags: ['cool', 'harsh', 'indoor', 'tense'],
    displayOrder: 7,
    isActive: true,
  },
  {
    id: 'candlelight_warm',
    nameZh: '燭光暖調',
    nameEn: 'Candlelight Warm',
    thumbnailUrl: null,
    lightingOverride:
      'intimate candlelight glow, warm orange flickering illumination, deep shadows surrounding warm light pool, romantic dim atmosphere, single light source feel',
    additionalNegative: 'bright lighting, daytime, fluorescent, modern lighting',
    bestForMoods: ['romantic intimate', 'ancient', 'ritual'],
    tags: ['warm', 'intimate', 'dim', 'candlelit'],
    displayOrder: 8,
    isActive: true,
  },
];
