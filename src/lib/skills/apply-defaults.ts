/**
 * Phase 2.5 Step 4-A (2026-06-11) — Pure payload-merge helper.
 *
 * Priority chain (only applies fields the user did NOT explicitly set):
 *   payload (user-supplied) > skill.defaults > undefined (worker keeps fallbacks)
 *
 * Pure function — no IO, no Prisma, no logging. Caller decides what to
 * do with the merged result. Used both by the route (to enrich
 * payload before submitTask) and by tests.
 *
 * Spec: IMPL_PREP/R-skill-primitive.md §5
 * Plan: .claude/plan/skill-worker-dispatch.md (Sub-commit 4-A)
 */

import type { SkillConfig } from './types'

export function applySkillDefaultsToPayload(
  payload: Record<string, unknown>,
  config: SkillConfig,
): Record<string, unknown> {
  const d = config.defaults
  const merged: Record<string, unknown> = { ...payload }

  if (merged.aspectRatio === undefined && d.aspectRatio) {
    merged.aspectRatio = d.aspectRatio
  }
  if (
    merged.totalDurationSeconds === undefined &&
    typeof d.durationPerShotSec === 'number' &&
    typeof d.shotCount === 'number'
  ) {
    merged.totalDurationSeconds = d.durationPerShotSec * d.shotCount
  }
  if (merged.resolution === undefined && d.resolution) {
    merged.resolution = d.resolution
  }
  if (merged.visualStyleId === undefined && d.visualStyleId) {
    merged.visualStyleId = d.visualStyleId
  }

  return merged
}
