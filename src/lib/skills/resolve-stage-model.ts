/**
 * Phase 2.5 Step 4-A (2026-06-11) — Pure helper: find the model pinned
 * for a given pipeline stage.
 *
 * Pulled forward from 4-B because the multi-shot route uses this at
 * submitTask time to pin `videoModel` BEFORE billing freezes the cost.
 * If we resolved at worker time instead, billing could freeze on the
 * payload's default model and then the worker would dispatch to a
 * different model, double-charging or undercharging.
 *
 * Pure function — no IO. Returns null when the stage isn't pinned.
 *
 * Spec: IMPL_PREP/R-skill-primitive.md §5
 * Plan: .claude/plan/skill-worker-dispatch.md (Sub-commit 4-A, used by 4-B)
 */

import type { SkillConfig, SkillStageId } from './types'

export function resolveStageModel(
  config: SkillConfig,
  stage: SkillStageId,
): string | null {
  const match = config.pipeline.find((s) => s.stage === stage)
  return match?.model ?? null
}

/**
 * Same lookup, but walks an ordered fallback list of stages — first
 * match wins. Some Skill configs use `generate_panel_video`, others
 * use `composite_multi_shot` for the same effective video stage; the
 * worker treats them as interchangeable.
 */
export function resolveStageModelWithFallback(
  config: SkillConfig,
  stages: SkillStageId[],
): string | null {
  for (const stage of stages) {
    const model = resolveStageModel(config, stage)
    if (model) return model
  }
  return null
}
