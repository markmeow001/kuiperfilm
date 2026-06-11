/**
 * Phase 2.5 Step 4-B (2026-06-11) — Task type ↔ SkillStageId mapping
 * with ordered fallback.
 *
 * Different official Skills express the same logical video stage with
 * different SkillStageId values. drama-short-seedance-voice uses
 * `generate_panel_video`; script-driven-cinematic uses
 * `composite_multi_shot`. The worker treats them as interchangeable
 * for the purpose of "what model drives the video pipeline".
 *
 * resolveStageModelWithFallback (in resolve-stage-model.ts) walks
 * this list in order and returns the first stage that has a model.
 *
 * Plan: .claude/plan/skill-worker-dispatch.md (Sub-commit 4-B)
 */

import type { TaskType } from '@/lib/task/types'
import { TASK_TYPE } from '@/lib/task/types'
import type { SkillStageId } from './types'

/**
 * Returns the ordered list of Skill stages relevant to a task type.
 * The list is walked in priority order — first stage with a model
 * wins. Empty list means the task type is not Skill-driven yet.
 */
export function getRelevantStagesForTask(taskType: TaskType): SkillStageId[] {
  switch (taskType) {
    case TASK_TYPE.VIDEO_MULTI_SHOT:
      // Both terms cover the multi-shot composite stage. drama-short
      // and previs-action use generate_panel_video; script-driven uses
      // composite_multi_shot. First-match-wins.
      return ['generate_panel_video', 'composite_multi_shot']
    case TASK_TYPE.VIDEO_PANEL:
      return ['generate_panel_video']
    case TASK_TYPE.IMAGE_PANEL:
      return ['generate_panel_image']
    case TASK_TYPE.IMAGE_CHARACTER:
    case TASK_TYPE.IMAGE_LOCATION:
    case TASK_TYPE.IMAGE_PROP:
      return ['generate_keyframe']
    case TASK_TYPE.VOICE_LINE:
      return ['tts_voice_line']
    case TASK_TYPE.LIP_SYNC:
      return ['lip_sync']
    default:
      return []
  }
}
