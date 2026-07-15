import { describe, expect, it } from 'vitest'
import {
  categorizeTaskType,
  ALL_CATEGORIES,
  type UsageCategory,
} from '@/lib/usage/task-categorizer'
import { TASK_TYPE } from '@/lib/task/types'

describe('categorizeTaskType', () => {
  it('buckets video / Kling Omni multi-shot under "video"', () => {
    expect(categorizeTaskType(TASK_TYPE.VIDEO_MULTI_SHOT)).toBe('video')
    expect(categorizeTaskType(TASK_TYPE.VIDEO_PANEL)).toBe('video')
    expect(categorizeTaskType(TASK_TYPE.VIDEO_EDITOR_RENDER)).toBe('video')
    expect(categorizeTaskType(TASK_TYPE.LIP_SYNC)).toBe('video')
  })

  it('buckets all image-* and asset-hub-* gen tasks under "image"', () => {
    const imageTasks = [
      TASK_TYPE.IMAGE_PANEL,
      TASK_TYPE.IMAGE_CHARACTER,
      TASK_TYPE.IMAGE_LOCATION,
      TASK_TYPE.IMAGE_PROP,
      TASK_TYPE.PANEL_VARIANT,
      TASK_TYPE.MODIFY_ASSET_IMAGE,
      TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER,
      TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION,
      TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER,
      TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION,
      TASK_TYPE.AI_CREATE_CHARACTER,
      TASK_TYPE.AI_CREATE_LOCATION,
      TASK_TYPE.REFERENCE_TO_CHARACTER,
    ]
    for (const t of imageTasks) {
      expect(categorizeTaskType(t)).toBe('image')
    }
  })

  it('buckets analyze / storyboard / character_profile under "analyze"', () => {
    const analyzeTasks = [
      TASK_TYPE.ANALYZE_NOVEL,
      TASK_TYPE.ANALYZE_GLOBAL,
      TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
      TASK_TYPE.CLIPS_BUILD,
      TASK_TYPE.SCREENPLAY_CONVERT,
      TASK_TYPE.STORY_TO_SCRIPT_RUN,
      TASK_TYPE.VOICE_ANALYZE, // dialogue extraction is text analysis
      TASK_TYPE.EPISODE_SPLIT_LLM,
      TASK_TYPE.CHARACTER_PROFILE_CONFIRM,
      TASK_TYPE.CHARACTER_PROFILE_BATCH_CONFIRM,
      TASK_TYPE.CANVAS_DIRECTOR_BLOCKING,
    ]
    for (const t of analyzeTasks) {
      expect(categorizeTaskType(t)).toBe('analyze')
    }
  })

  it('buckets voice synthesis under "voice" (separate from voice_analyze)', () => {
    expect(categorizeTaskType(TASK_TYPE.VOICE_LINE)).toBe('voice')
    expect(categorizeTaskType(TASK_TYPE.VOICE_DESIGN)).toBe('voice')
    expect(categorizeTaskType(TASK_TYPE.ASSET_HUB_VOICE_DESIGN)).toBe('voice')
    // voice_analyze is dialogue extraction (LLM), NOT TTS — see analyze test
  })

  it('returns "other" for unknown / future task types (defensive default)', () => {
    expect(categorizeTaskType('something_brand_new')).toBe('other')
    expect(categorizeTaskType('')).toBe('other')
  })

  it('every TASK_TYPE value is classified into one of the 5 categories', () => {
    // This codifies that the categorizer covers EVERY task type in the
    // catalog. If a new task type is added without updating the
    // categorizer, this test fails — preventing silent "other" buckets
    // sneaking into the dashboard.
    const knownCats = new Set<UsageCategory>(ALL_CATEGORIES)
    for (const t of Object.values(TASK_TYPE)) {
      const cat = categorizeTaskType(t)
      expect(knownCats.has(cat), `task type ${t} → ${cat} (unknown category)`).toBe(true)
    }
  })

  it('exactly one of {video, image, analyze, voice} owns each modern TASK_TYPE — "other" is reserved for future drift', () => {
    const otherDrifts = Object.values(TASK_TYPE).filter(
      (t) => categorizeTaskType(t) === 'other',
    )
    // Currently we expect zero drifts. If you're adding a new task type
    // and this list grew, decide which bucket it belongs to and update
    // task-categorizer.ts.
    expect(otherDrifts).toEqual([])
  })
})
