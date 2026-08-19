/**
 * Task type → high-level usage category mapping.
 *
 * Used by /api/usage/* endpoints to bucket the 30+ task.type values
 * into stat-friendly groups the UI can render as "今天: 5 视频 / 12 图
 * / 3 分析 / 0 配音". One source of truth — keep aligned with
 * TASK_TYPE in src/lib/task/types.ts.
 *
 * Categories:
 *   - video   : multi-shot Kling Omni / single-panel video / lip-sync /
 *               editor render
 *   - image   : every character / location / prop / panel image gen
 *               (incl. asset-hub variants and ai-modify-image flows)
 *   - analyze : LLM-only "文案分析" tasks — script analysis, storyboard
 *               planning, character profile, screenplay convert, etc.
 *   - voice   : TTS / voice design (separate from speaking-line audio
 *               that gets generated as part of video tasks)
 *   - other   : fallback for anything not yet classified — UI can show
 *               this as "其他" and we'll keep an eye on it for new
 *               task types.
 *
 * Whenever TASK_TYPE adds a new value, this file should adopt it. A
 * defensive `other` fallback keeps stats well-formed during the
 * transition window if rollout ordering misses a sync.
 */
export type UsageCategory = 'video' | 'image' | 'analyze' | 'voice' | 'other'

const VIDEO_TYPES = new Set<string>([
  'video_multi_shot',
  'video_panel',
  'video_editor_render',
  'lip_sync',
  // Phase 12.7 FFmpeg full-episode mp4 stitch — counts as a "video"
  // generation event from the user's POV (one click → one mp4 out).
  'episode_stitch_mp4',
  // Phase 9.1 — Playground video rides the Task spine; categorize like any
  // other video gen so usage stats + the rate-limit gate apply.
  'playground_video',
  'canvas_compose_video',
  'canvas_storyboard_export',
])

const IMAGE_TYPES = new Set<string>([
  'image_panel',
  'image_character',
  'image_location',
  'image_prop',
  'panel_variant',
  'regenerate_group',
  'modify_asset_image',
  'insert_panel',
  'asset_hub_image',
  'asset_hub_modify',
  'asset_hub_ai_design_character',
  'asset_hub_ai_design_location',
  'asset_hub_ai_modify_character',
  'asset_hub_ai_modify_location',
  'asset_hub_reference_to_character',
  'ai_modify_appearance',
  'ai_modify_location',
  'ai_create_character',
  'ai_create_location',
  'reference_to_character',
  // Phase 9.1 — Playground image rides the Task spine.
  'playground_image',
  'visual_development_image',
])

const ANALYZE_TYPES = new Set<string>([
  'analyze_novel',
  'analyze_global',
  'analyze_shot_variants',
  'script_to_storyboard_run',
  'clips_build',
  'screenplay_convert',
  'story_to_script_run',
  'voice_analyze', // dialogue extraction is text analysis, not voice synth
  'episode_split_llm',
  'character_profile_confirm',
  'character_profile_batch_confirm',
  'ai_modify_shot_prompt',
  'auto_group_multi_shot',
  'regenerate_storyboard_text',
  'canvas_storyboard',
  'canvas_director_routes',
  'canvas_director_blocking',
  'canvas_text',
  'playground_video_analyze',
  'visual_development_script_analysis',
  'visual_development_stage_brief',
  // Provider-side asset ingestion/validation. It creates no image or video;
  // count it with analysis/preparation work instead of leaving usage drift.
  'register_ark_asset',
])

const VOICE_TYPES = new Set<string>([
  'voice_line',
  'voice_design',
  'asset_hub_voice_design',
  'canvas_tts',
])

export function categorizeTaskType(taskType: string): UsageCategory {
  if (VIDEO_TYPES.has(taskType)) return 'video'
  if (IMAGE_TYPES.has(taskType)) return 'image'
  if (ANALYZE_TYPES.has(taskType)) return 'analyze'
  if (VOICE_TYPES.has(taskType)) return 'voice'
  return 'other'
}

/**
 * Inverse of categorizeTaskType — return every task.type value that
 * belongs to a given category. Lets `WHERE type IN (...)` queries
 * filter recent tasks per category without re-deriving the set.
 *
 * Returns [] for 'other' on purpose — 'other' is the residual bucket
 * and we don't want to manifest the exact list (it shifts as new task
 * types get added before they're categorized).
 */
export function getTaskTypesForCategory(category: UsageCategory): string[] {
  switch (category) {
    case 'video':
      return Array.from(VIDEO_TYPES)
    case 'image':
      return Array.from(IMAGE_TYPES)
    case 'analyze':
      return Array.from(ANALYZE_TYPES)
    case 'voice':
      return Array.from(VOICE_TYPES)
    case 'other':
      return []
  }
}

export const ALL_CATEGORIES: readonly UsageCategory[] = [
  'video',
  'image',
  'analyze',
  'voice',
  'other',
] as const
