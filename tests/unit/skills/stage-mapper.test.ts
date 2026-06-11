/**
 * Phase 2.5 Step 4-B — stage-mapper contract.
 *
 * Ensures task types map to the right SkillStageId fallback list.
 */
import { describe, expect, it } from 'vitest'
import { getRelevantStagesForTask } from '@/lib/skills/stage-mapper'
import { TASK_TYPE } from '@/lib/task/types'

describe('getRelevantStagesForTask', () => {
  it('maps VIDEO_MULTI_SHOT to ordered fallback [generate_panel_video, composite_multi_shot]', () => {
    expect(getRelevantStagesForTask(TASK_TYPE.VIDEO_MULTI_SHOT)).toEqual([
      'generate_panel_video',
      'composite_multi_shot',
    ])
  })

  it('maps VIDEO_PANEL to [generate_panel_video]', () => {
    expect(getRelevantStagesForTask(TASK_TYPE.VIDEO_PANEL)).toEqual([
      'generate_panel_video',
    ])
  })

  it('maps IMAGE_PANEL to [generate_panel_image]', () => {
    expect(getRelevantStagesForTask(TASK_TYPE.IMAGE_PANEL)).toEqual([
      'generate_panel_image',
    ])
  })

  it('maps IMAGE_CHARACTER / IMAGE_LOCATION / IMAGE_PROP to [generate_keyframe]', () => {
    expect(getRelevantStagesForTask(TASK_TYPE.IMAGE_CHARACTER)).toEqual([
      'generate_keyframe',
    ])
    expect(getRelevantStagesForTask(TASK_TYPE.IMAGE_LOCATION)).toEqual([
      'generate_keyframe',
    ])
    expect(getRelevantStagesForTask(TASK_TYPE.IMAGE_PROP)).toEqual([
      'generate_keyframe',
    ])
  })

  it('maps VOICE_LINE to [tts_voice_line]', () => {
    expect(getRelevantStagesForTask(TASK_TYPE.VOICE_LINE)).toEqual([
      'tts_voice_line',
    ])
  })

  it('maps LIP_SYNC to [lip_sync]', () => {
    expect(getRelevantStagesForTask(TASK_TYPE.LIP_SYNC)).toEqual(['lip_sync'])
  })

  it('returns empty list for task types not Skill-driven yet', () => {
    expect(getRelevantStagesForTask(TASK_TYPE.ANALYZE_NOVEL)).toEqual([])
    expect(getRelevantStagesForTask(TASK_TYPE.REGISTER_ARK_ASSET)).toEqual([])
  })
})
