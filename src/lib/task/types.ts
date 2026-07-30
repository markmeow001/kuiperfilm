import type { Locale } from '@/i18n/routing'

export const TASK_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DISMISSED: 'dismissed',
} as const

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS]

export const TASK_EVENT_TYPE = {
  CREATED: 'task.created',
  PROCESSING: 'task.processing',
  PROGRESS: 'task.progress',
  COMPLETED: 'task.completed',
  FAILED: 'task.failed',
} as const

export type TaskEventType = (typeof TASK_EVENT_TYPE)[keyof typeof TASK_EVENT_TYPE]

export const TASK_SSE_EVENT_TYPE = {
  LIFECYCLE: 'task.lifecycle',
  STREAM: 'task.stream',
} as const

export type TaskSSEEventType = (typeof TASK_SSE_EVENT_TYPE)[keyof typeof TASK_SSE_EVENT_TYPE]

export const TASK_LIFECYCLE_EVENT_TYPES = [
  TASK_EVENT_TYPE.CREATED,
  TASK_EVENT_TYPE.PROCESSING,
  TASK_EVENT_TYPE.COMPLETED,
  TASK_EVENT_TYPE.FAILED,
] as const

export type TaskLifecycleEventType = (typeof TASK_LIFECYCLE_EVENT_TYPES)[number]

export const TASK_TYPE = {
  IMAGE_PANEL: 'image_panel',
  IMAGE_CHARACTER: 'image_character',
  IMAGE_LOCATION: 'image_location',
  IMAGE_PROP: 'image_prop',
  VIDEO_PANEL: 'video_panel',
  LIP_SYNC: 'lip_sync',
  VOICE_LINE: 'voice_line',
  VOICE_DESIGN: 'voice_design',
  ASSET_HUB_VOICE_DESIGN: 'asset_hub_voice_design',
  REGENERATE_STORYBOARD_TEXT: 'regenerate_storyboard_text',
  INSERT_PANEL: 'insert_panel',
  PANEL_VARIANT: 'panel_variant',
  MODIFY_ASSET_IMAGE: 'modify_asset_image',
  REGENERATE_GROUP: 'regenerate_group',
  ASSET_HUB_IMAGE: 'asset_hub_image',
  ASSET_HUB_MODIFY: 'asset_hub_modify',
  ANALYZE_NOVEL: 'analyze_novel',
  STORY_TO_SCRIPT_RUN: 'story_to_script_run',
  SCRIPT_TO_STORYBOARD_RUN: 'script_to_storyboard_run',
  CLIPS_BUILD: 'clips_build',
  SCREENPLAY_CONVERT: 'screenplay_convert',
  VOICE_ANALYZE: 'voice_analyze',
  ANALYZE_GLOBAL: 'analyze_global',
  AI_MODIFY_APPEARANCE: 'ai_modify_appearance',
  AI_MODIFY_LOCATION: 'ai_modify_location',
  AI_MODIFY_SHOT_PROMPT: 'ai_modify_shot_prompt',
  ANALYZE_SHOT_VARIANTS: 'analyze_shot_variants',
  AI_CREATE_CHARACTER: 'ai_create_character',
  AI_CREATE_LOCATION: 'ai_create_location',
  REFERENCE_TO_CHARACTER: 'reference_to_character',
  CHARACTER_PROFILE_CONFIRM: 'character_profile_confirm',
  CHARACTER_PROFILE_BATCH_CONFIRM: 'character_profile_batch_confirm',
  EPISODE_SPLIT_LLM: 'episode_split_llm',
  ASSET_HUB_AI_DESIGN_CHARACTER: 'asset_hub_ai_design_character',
  ASSET_HUB_AI_DESIGN_LOCATION: 'asset_hub_ai_design_location',
  ASSET_HUB_AI_MODIFY_CHARACTER: 'asset_hub_ai_modify_character',
  ASSET_HUB_AI_MODIFY_LOCATION: 'asset_hub_ai_modify_location',
  ASSET_HUB_REFERENCE_TO_CHARACTER: 'asset_hub_reference_to_character',
  VIDEO_MULTI_SHOT: 'video_multi_shot',
  VIDEO_EDITOR_RENDER: 'video_editor_render',
  EPISODE_STITCH_MP4: 'episode_stitch_mp4',
  // 2026-05-22 — 火山方舟 asset registration. Async pre-flight that
  // turns a character appearance / location image / prop image into an
  // ARK asset:// reference so Seedance 2.0 will accept it (its real-
  // person face filter rejects raw URLs of photorealistic AI portraits).
  REGISTER_ARK_ASSET: 'register_ark_asset',
  // Phase 9.1 (2026-06-20) — Playground (standalone text/image→image,
  // image/text→video) now rides the unified Task spine instead of a
  // bespoke PlaygroundRun path. projectId is the synthetic 'playground'
  // sentinel (no FK on Task.projectId; already in billing VIRTUAL_PROJECT_IDS).
  PLAYGROUND_IMAGE: 'playground_image',
  VISUAL_DEVELOPMENT_IMAGE: 'visual_development_image',
  VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS: 'visual_development_script_analysis',
  VISUAL_DEVELOPMENT_STAGE_BRIEF: 'visual_development_stage_brief',
  PLAYGROUND_VIDEO: 'playground_video',
  PLAYGROUND_VIDEO_ANALYZE: 'playground_video_analyze',
  // Canvas 无限画布 script node — pasted/wired script → LLM → array of
  // storyboard shots (text-only). Rides the text worker; result JSON is read
  // back via /api/tasks/[taskId]. Uses the 'playground' virtual project id.
  CANVAS_STORYBOARD: 'canvas_storyboard',
  CANVAS_DIRECTOR_ROUTES: 'canvas_director_routes',
  CANVAS_DIRECTOR_BLOCKING: 'canvas_director_blocking',
  // Canvas 无限画布 text node writing assistant (扩写/改写/润色/续写) — text-only,
  // rides the text worker; plain-text result read back via /api/tasks/[taskId].
  CANVAS_TEXT: 'canvas_text',
  // Canvas 无限画布 audio node — text + a reference voice clip → cloned TTS
  // (FAL IndexTTS2). Rides the VOICE worker; result audio url in Task.result.
  CANVAS_TTS: 'canvas_tts',
  // Canvas composition is CPU-only and free in v1. Routed to VIDEO queue but
  // executed behind a global concurrency=1 guard and replaceable executor.
  CANVAS_COMPOSE_VIDEO: 'canvas_compose_video',
  CANVAS_STORYBOARD_EXPORT: 'canvas_storyboard_export',
} as const

export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE]

export type QueueType = 'image' | 'video' | 'voice' | 'text'

export type BillingMode = 'OFF' | 'SHADOW' | 'ENFORCE'

export type TaskBillingInfo =
  | {
    billable: false
    source?: 'task'
    status?: 'skipped'
  }
  | {
    billable: true
    source: 'task'
    taskType: TaskType
    apiType: 'text' | 'image' | 'video' | 'voice' | 'voice-design' | 'lip-sync'
    model: string
    quantity: number
    unit: 'token' | 'image' | 'video' | 'second' | 'call'
    maxFrozenCost: number
    pricingVersion?: string
    action: string
    metadata?: Record<string, unknown>
    billingKey?: string
    freezeId?: string | null
    modeSnapshot?: BillingMode | null
    status?: 'skipped' | 'quoted' | 'frozen' | 'settled' | 'rolled_back' | 'failed'
    chargedCost?: number
  }

export type TaskJobData = {
  taskId: string
  type: TaskType
  locale: Locale
  projectId: string
  episodeId?: string | null
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  billingInfo?: TaskBillingInfo | null
  userId: string
  trace?: {
    requestId?: string | null
  } | null
  /**
   * Provider hand-off checkpoint stored in BullMQ job data. It mirrors
   * Task.externalId so a retry can resume even when the database was
   * temporarily unavailable immediately after a paid provider submission.
   */
  providerExternalId?: string | null
  // Phase 2.5 (2026-06-11) — when set, worker loads Skill.config and
  // uses it for prompt overlays + constraint context. videoModel is
  // already pinned in payload by submitTask (so billing freezes on
  // the resolved model). null/undefined = legacy / 自由創作 flows.
  skillId?: string | null
}

export type SSEEvent = {
  id: string
  type: TaskSSEEventType
  taskId: string
  projectId: string
  userId: string
  ts: string
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  episodeId?: string | null
  payload?: (Record<string, unknown> & {
    lifecycleType?: TaskLifecycleEventType
  }) | null
}

export type CreateTaskInput = {
  userId: string
  projectId: string
  episodeId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  dedupeKey?: string | null
  /**
   * `active` keeps the legacy behavior: an active task is reused, while a
   * terminal task releases the key so the operation can be retried.
   * `idempotent` treats the key as an HTTP idempotency key and always reuses
   * the first row, including terminal outcomes.
   */
  dedupeMode?: 'active' | 'idempotent'
  priority?: number
  maxAttempts?: number
  billingInfo?: TaskBillingInfo | null
}
