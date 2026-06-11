/**
 * Phase 2.5 (2026-06-10) — Official KuiperAI Skills registry.
 *
 * Six default Skills mirroring flova.ai's 「我的 Skill」 section, each
 * mapped to existing KuiperAI workers. See IMPL_PREP/R-skill-primitive.md
 * §6 for the design rationale + worker chain breakdown.
 *
 * This file is the SOURCE OF TRUTH for the official Skills. A seed
 * script reads it and upserts rows into the `skills` table at deploy
 * time. Editing this file → re-run seed → DB updated. Adding new
 * official Skills only requires extending this array.
 *
 * Community Skills live in the DB only (not here). Authors submit via
 * the Phase 3.5 marketplace flow.
 */

import type { SkillConfig } from './types'

export interface OfficialSkillDef {
  slug: string
  name: string
  nameEn: string
  description: string
  descriptionEn: string
  thumbnailUrl: string | null
  isFeatured: boolean
  config: SkillConfig
}

/**
 * The 6 default Skills. Order in this array drives default UI sort.
 *
 * Drama-short is FIRST because it's the canonical short-drama use case
 * and the one most users will reach for. The featured flag highlights
 * it in the picker.
 */
export const OFFICIAL_SKILLS: OfficialSkillDef[] = [
  {
    slug: 'drama-short-seedance-voice',
    name: '劇情短片視頻',
    nameEn: 'Drama Short Film (voice-anchored)',
    description: [
      '核心亮點：',
      '- 角色語音錨定：每個角色在元素階段都有專屬的參考音頻，確保整個過程中語調的一致性。',
      '- 由 Seedance 2.0 驅動 — 省略關鍵幀步驟，直接從元素圖像生成最終鏡頭。',
      '- 循序漸進的人機協作 — 在每個關鍵階段進行確認，以保持完全掌控。',
    ].join('\n'),
    descriptionEn: [
      'Highlights:',
      '- Per-character voice anchoring — each character has a reference audio at the Element stage, locking vocal continuity across shots.',
      '- Powered by Seedance 2.0 — skips the keyframe step, generates final shots directly from Element images.',
      '- Step-by-step human-in-the-loop confirmation to keep full creative control.',
    ].join('\n'),
    thumbnailUrl: null,
    isFeatured: true,
    config: {
      version: 1,
      input: {
        minElementsCount: 1,
      },
      pipeline: [
        { stage: 'analyze_script' },
        { stage: 'tts_voice_line' },
        { stage: 'generate_panel_image', model: 'atlascloud::nano-banana-2' },
        { stage: 'generate_panel_video', model: 'ark::seedance-2.0' },
        { stage: 'stitch_final' },
      ],
      defaults: {
        aspectRatio: '9:16',
        durationPerShotSec: 10,
        shotCount: 6,
        resolution: '1080p',
        audioMode: 'voiced',
        voNarration: 'on_request',
      },
      constraints: {
        enforceAudioRefPerCharacter: true,
      },
    },
  },

  {
    slug: 'script-driven-cinematic',
    name: '劇本驅動型視頻',
    nameEn: 'Script-driven Cinematic Video',
    description: [
      '分析上傳的劇本 (圖片/PDF/文本)，通過學習其電影語法 — 提取腳本、鏡頭結構、視覺語言和節奏 — 圍繞您的主題生成全新的視頻。',
      '使用 Nano Banana + Seedance 2.0 生成視覺素材。',
    ].join('\n'),
    descriptionEn: [
      'Analyzes an uploaded script (image / PDF / text), learning its cinematic grammar — script structure, shot composition, visual language, pacing — and generates a new video around your theme.',
      'Uses Nano Banana + Seedance 2.0 for visual assets.',
    ].join('\n'),
    thumbnailUrl: null,
    isFeatured: true,
    config: {
      version: 1,
      input: {
        requiresScript: true,
      },
      pipeline: [
        { stage: 'analyze_script' },
        { stage: 'generate_keyframe', model: 'atlascloud::nano-banana-2' },
        { stage: 'composite_multi_shot', model: 'ark::seedance-2.0' },
        { stage: 'stitch_final' },
      ],
      defaults: {
        aspectRatio: '9:16',
        resolution: '1080p',
        audioMode: 'ambient',
      },
    },
  },

  {
    slug: 'product-promo-commercial',
    name: '商品宣傳短片',
    nameEn: 'Product Promo Short Film',
    description: [
      '快速創建 AI 商業廣告短片，為您的產品呈現專業級的視覺效果和創意故事。',
      '使用模型 Nano Banana + Seedance 2.0。',
    ].join('\n'),
    descriptionEn: [
      'Quickly create AI commercial shorts that showcase your product with professional-grade visuals and creative storytelling.',
      'Uses Nano Banana + Seedance 2.0.',
    ].join('\n'),
    thumbnailUrl: null,
    isFeatured: false,
    config: {
      version: 1,
      input: {
        requiresProductImage: true,
      },
      pipeline: [
        { stage: 'generate_keyframe', model: 'atlascloud::nano-banana-2' },
        { stage: 'generate_panel_video', model: 'ark::seedance-2.0' },
        { stage: 'stitch_final' },
      ],
      defaults: {
        aspectRatio: '16:9',
        durationPerShotSec: 8,
        shotCount: 4,
        resolution: '1080p',
        audioMode: 'bgm',
      },
    },
  },

  {
    slug: 'music-mv-omnihuman',
    name: '音樂 MV',
    nameEn: 'Music MV',
    description: [
      '專為音樂 MV 製作設計的工作流，根據上傳的音樂驅動主角演唱表演。',
      '依托 Omnihuman 數字人對口型模型，實現高度精準的口型同步和富有表現力的表演。',
    ].join('\n'),
    descriptionEn: [
      'Workflow designed for music video production, driving lead vocalist performance from uploaded audio.',
      'Powered by Omnihuman digital-human lip-sync for highly precise mouth synchronization and expressive performance.',
    ].join('\n'),
    thumbnailUrl: null,
    isFeatured: false,
    config: {
      version: 1,
      input: {
        requiresMusic: true,
        minElementsCount: 1,
      },
      pipeline: [
        { stage: 'generate_panel_image', model: 'atlascloud::nano-banana-2' },
        { stage: 'lip_sync' },
        { stage: 'stitch_final' },
      ],
      defaults: {
        aspectRatio: '9:16',
        resolution: '1080p',
        audioMode: 'voiced',
        voNarration: 'never',
      },
    },
  },

  {
    slug: 'previs-action-storyboard',
    name: '動作預演分鏡視頻',
    nameEn: 'Action PREVIS Storyboard',
    description: [
      '專為動作導演預演 (PREVIS) 場景設計。生成極簡火柴人風格的 PREVIS 動作分鏡故事板 (每板最多 8 個連續動作畫面，2×4 網格)。',
      '再結合用戶提供的角色三視圖，使用 Seedance 2.0 全能參考功能生成每板不超過 15 秒的連續動作視頻。',
    ].join('\n'),
    descriptionEn: [
      'Designed for action director PREVIS scenes. Generates minimalist matchstick-figure PREVIS storyboards (up to 8 consecutive action frames per board, 2×4 grid).',
      'Combined with user-provided character orthographic views, uses Seedance 2.0 reference-to-video to produce ≤15s continuous action clips per board.',
    ].join('\n'),
    thumbnailUrl: null,
    isFeatured: false,
    config: {
      version: 1,
      input: {
        minElementsCount: 1,
      },
      pipeline: [
        { stage: 'generate_storyboard_grid', model: 'atlascloud::nano-banana-2', settings: { grid: '2x4' } },
        { stage: 'generate_panel_video', model: 'ark::seedance-2.0' },
        { stage: 'stitch_final' },
      ],
      defaults: {
        aspectRatio: '16:9',
        durationPerShotSec: 15,
        storyboardGrid: '2x4',
        resolution: '1080p',
        audioMode: 'silent',
      },
    },
  },

  {
    slug: 'reference-recreation',
    name: '視頻拉片複刻',
    nameEn: 'Reference Video Recreation',
    description: [
      '通過學習上傳視頻的電影語法 (提取其腳本、鏡頭結構、視覺語言和節奏)，圍繞您自己的主題生成全新視頻。',
      '使用模型 Nano Banana + Seedance 2.0。',
    ].join('\n'),
    descriptionEn: [
      'Learns the cinematic grammar of an uploaded reference video (script, shot composition, visual language, pacing) and generates a new video around your own theme.',
      'Uses Nano Banana + Seedance 2.0.',
    ].join('\n'),
    thumbnailUrl: null,
    isFeatured: false,
    config: {
      version: 1,
      input: {
        requiresReferenceVideo: true,
      },
      pipeline: [
        { stage: 'analyze_script' },
        { stage: 'generate_keyframe', model: 'atlascloud::nano-banana-2' },
        { stage: 'generate_panel_video', model: 'ark::seedance-2.0' },
        { stage: 'stitch_final' },
      ],
      defaults: {
        aspectRatio: '9:16',
        resolution: '1080p',
        audioMode: 'ambient',
      },
    },
  },
]
