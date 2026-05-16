/**
 * Cross-task episode-level conflict matrix (F-QA-2 root cause).
 *
 * Some tasks mutate shared rows for a single `NovelPromotionEpisode`
 * (clips → storyboards → panels → voice lines). Running two of them
 * concurrently for the same episode causes:
 *
 *   - Foreign-key violations when one task's transaction inserts
 *     rows pointing at IDs another task has just cascade-deleted
 *     (the original F-QA-2 production bug: persistVoiceLines hit
 *     "Foreign key constraint violated on (matchedPanelId)" when
 *     clips_build replaced clips mid-flight).
 *   - Storyboard / panel data corruption visible to the user as
 *     "panels disappeared" or "wrong dialogue on wrong shot".
 *
 * dedupeKey already handles SAME-type races (DB unique constraint on
 * `Task.dedupeKey`). What it doesn't handle is DIFFERENT-type races
 * — `script_to_storyboard_run` for episode X concurrent with
 * `clips_build` for episode X. This matrix declares which task
 * types share an episode-level mutex, and submitTask rejects with
 * CONFLICT when another active task in the same group is already
 * running.
 *
 * Non-goals:
 *   - We don't queue blocked tasks. If conflict found, the API
 *     returns 409 CONFLICT and the UI surfaces it as "another
 *     operation is still running — try again in a few seconds".
 *   - We don't touch image / video / voice_design type tasks since
 *     those are per-panel/per-asset and don't mutate the storyboard
 *     skeleton.
 */
import { TASK_TYPE, type TaskType } from './types'

/**
 * Set of task types that mutate an episode's storyboard / panel
 * graph. Any two of these targeting the same episodeId at the same
 * time can corrupt each other's writes.
 */
export const EPISODE_STORYBOARD_MUTATION_TYPES: ReadonlySet<TaskType> = new Set([
  TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
  TASK_TYPE.CLIPS_BUILD,
])

export type EpisodeConflictGroup = 'storyboard-graph'

/**
 * Returns the conflict group a task type belongs to, or null when
 * the type doesn't participate in episode-level mutex semantics.
 */
export function episodeConflictGroupForType(type: TaskType): EpisodeConflictGroup | null {
  if (EPISODE_STORYBOARD_MUTATION_TYPES.has(type)) return 'storyboard-graph'
  return null
}

/**
 * Returns the set of task types that should not run concurrently
 * with the given type for the same episode.
 */
export function conflictingTaskTypesForType(type: TaskType): TaskType[] {
  const group = episodeConflictGroupForType(type)
  if (group === 'storyboard-graph') {
    return Array.from(EPISODE_STORYBOARD_MUTATION_TYPES).filter((t) => t !== type)
  }
  return []
}
