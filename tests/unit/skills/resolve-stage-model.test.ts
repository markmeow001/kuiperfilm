/**
 * Phase 2.5 Step 4-A — resolve-stage-model contract.
 *
 * Pure helper: pipeline.find by stage. First match wins.
 */
import { describe, expect, it } from 'vitest'
import {
  resolveStageModel,
  resolveStageModelWithFallback,
} from '@/lib/skills/resolve-stage-model'
import type { SkillConfig } from '@/lib/skills/types'

function makeConfig(pipeline: SkillConfig['pipeline']): SkillConfig {
  return {
    version: 1,
    input: {},
    pipeline,
    defaults: {},
  }
}

describe('resolveStageModel', () => {
  it('returns the pinned model for a present stage', () => {
    const config = makeConfig([
      { stage: 'generate_panel_image', model: 'atlascloud::nano-banana-2' },
      { stage: 'generate_panel_video', model: 'ark::seedance-2.0' },
    ])
    expect(resolveStageModel(config, 'generate_panel_video')).toBe('ark::seedance-2.0')
    expect(resolveStageModel(config, 'generate_panel_image')).toBe('atlascloud::nano-banana-2')
  })

  it('returns null when the stage is not in the pipeline', () => {
    const config = makeConfig([{ stage: 'generate_panel_video', model: 'ark::seedance-2.0' }])
    expect(resolveStageModel(config, 'tts_voice_line')).toBeNull()
  })

  it('returns null when the stage is present but has no model field', () => {
    const config = makeConfig([{ stage: 'generate_panel_video' }])
    expect(resolveStageModel(config, 'generate_panel_video')).toBeNull()
  })

  it('returns the first match when a stage appears twice', () => {
    const config = makeConfig([
      { stage: 'generate_panel_video', model: 'first' },
      { stage: 'generate_panel_video', model: 'second' },
    ])
    expect(resolveStageModel(config, 'generate_panel_video')).toBe('first')
  })
})

describe('resolveStageModelWithFallback', () => {
  it('returns the first stage that has a model', () => {
    const config = makeConfig([
      { stage: 'composite_multi_shot', model: 'composite-model' },
    ])
    const result = resolveStageModelWithFallback(config, [
      'generate_panel_video',
      'composite_multi_shot',
    ])
    expect(result).toBe('composite-model')
  })

  it('returns null when none of the fallback stages are present', () => {
    const config = makeConfig([{ stage: 'tts_voice_line', model: 'tts' }])
    const result = resolveStageModelWithFallback(config, [
      'generate_panel_video',
      'composite_multi_shot',
    ])
    expect(result).toBeNull()
  })

  it('prefers the first stage even if a later one is also present', () => {
    const config = makeConfig([
      { stage: 'generate_panel_video', model: 'preferred' },
      { stage: 'composite_multi_shot', model: 'fallback' },
    ])
    const result = resolveStageModelWithFallback(config, [
      'generate_panel_video',
      'composite_multi_shot',
    ])
    expect(result).toBe('preferred')
  })
})
