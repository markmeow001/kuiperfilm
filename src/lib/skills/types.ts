/**
 * Phase 2.5 (2026-06-10) — Skill primitive runtime types.
 *
 * Mirrors the `Skill.config` JSON column shape from prisma/schema.prisma.
 * See IMPL_PREP/R-skill-primitive.md §5 for the canonical spec.
 *
 * Versioned via `version: 1` so future schema bumps stay backward-
 * compatible. Workers consume `SkillConfig` as the source of truth for
 * "what does this Skill do when the user runs it" — input gates,
 * model chain stages, default settings, prompt overrides, and
 * guardrails.
 */

/** Top-level Skill runtime config. Stored as JSON in `Skill.config`. */
export interface SkillConfig {
  version: 1

  /** What the UI must collect before the user can submit. Worker
   *  consults the same fields server-side as a defensive check. */
  input: SkillInput

  /** Ordered list of worker stages. Each maps to an existing KuiperAI
   *  worker handler. Mix-and-match across stages — e.g. analyze_script
   *  → generate_keyframe → generate_panel_video → stitch_final. */
  pipeline: SkillPipelineStage[]

  /** Default project settings applied when the Skill is selected.
   *  User can override per-project in the UI before submit. */
  defaults: SkillDefaults

  /** Optional prompt template overrides. When set, replaces the
   *  generic NP_AGENT_STORYBOARD_DETAIL template for that stage. */
  prompts?: SkillPromptOverrides

  /** Optional guardrails enforced at submit + worker time. */
  constraints?: SkillConstraints
}

export interface SkillInput {
  /** 「需上傳劇本」— blocks submit until user uploads. */
  requiresScript?: boolean
  /** 「需上傳音樂」— for MV Skills. */
  requiresMusic?: boolean
  /** 「需上傳產品圖」— for product-promo Skills. */
  requiresProductImage?: boolean
  /** 「需上傳參考影片」— for reference-recreation Skills. */
  requiresReferenceVideo?: boolean
  /** 「需上傳寵物照片」+ count — for pet-vlog Skills. */
  requiresPetImage?: { count: 1 | 2 }
  /** 「需要主題文字」— for theme-transformation Skills. */
  requiresThemeText?: boolean
  /** Minimum number of characters required in 劇集設定. */
  minElementsCount?: number
}

export type SkillStageId =
  | 'analyze_script'
  | 'generate_keyframe'
  | 'generate_storyboard_grid'
  | 'generate_panel_image'
  | 'generate_panel_video'
  | 'composite_multi_shot'
  | 'tts_voice_line'
  | 'lip_sync'
  | 'stitch_final'

export interface SkillPipelineStage {
  stage: SkillStageId
  /** Override the user's selected model for THIS stage only. Useful
   *  when a Skill's recipe pins Nano Banana for keyframes even when
   *  the user's default image model is something else. */
  model?: string
  /** Per-stage parameters. e.g. `{ shotCount: 4 }` for storyboard grid. */
  settings?: Record<string, unknown>
}

export interface SkillDefaults {
  visualStyleId?: string
  aspectRatio?: '9:16' | '16:9' | '1:1'
  /** Seconds per shot. e.g. 10 for Seedance 2.0 max. */
  durationPerShotSec?: number
  /** Total shot count to generate. e.g. 3 for a 3-segment Skill. */
  shotCount?: number
  /** Storyboard grid format for PREVIS-style Skills. */
  storyboardGrid?: '2x3' | '2x4' | '3x4'
  /** Output resolution. Higher tiers paywall'd. */
  resolution?: '720p' | '1080p' | '2k' | '4k'
  /** Whether audio is generated and how. */
  audioMode?: 'silent' | 'ambient' | 'bgm' | 'voiced'
  /** When (if ever) to add VO narration. */
  voNarration?: 'never' | 'on_request' | 'always'
}

export interface SkillPromptOverrides {
  /** Replaces NP_AGENT_ANALYZE_NOVEL when set. */
  analyzeScript?: string
  /** Injected into NP_AGENT_STORYBOARD_DETAIL panel.description build. */
  panelDescription?: string
  /** Per-character style guidance. */
  characterStyling?: string
  /** Cinematography directives (camera move + framing language). */
  cinematography?: string
}

export interface SkillConstraints {
  /** Blacklist of subjects the Skill refuses to generate. e.g. ["real-face"]
   *  for NSFW-safe Skills. */
  forbiddenSubjects?: string[]
  /** Force portrait output regardless of user preference. */
  forcePortrait?: boolean
  /** Force landscape output regardless of user preference. */
  forceLandscape?: boolean
  /** When true, every character in 劇集設定 MUST have a referenceAudio
   *  before submit. Mirrors flova's 劇情短片視頻 voice-anchor rule. */
  enforceAudioRefPerCharacter?: boolean
}
