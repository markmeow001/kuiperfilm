/**
 * B / F-QA-2 root cause regression: episode-level conflict matrix.
 *
 * Locks in which task types are mutually exclusive per episode. If
 * either side of a pair is added to the matrix without the other,
 * the conflict guard becomes asymmetric and one direction silently
 * leaks the race.
 */
import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import {
  EPISODE_STORYBOARD_MUTATION_TYPES,
  episodeConflictGroupForType,
  conflictingTaskTypesForType,
} from '@/lib/task/episode-conflict-matrix'

describe('EPISODE_STORYBOARD_MUTATION_TYPES (F-QA-2 root cause)', () => {
  it('includes script_to_storyboard_run', () => {
    expect(EPISODE_STORYBOARD_MUTATION_TYPES.has(TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)).toBe(true)
  })

  it('includes clips_build (the actual second-writer in the prod incident)', () => {
    expect(EPISODE_STORYBOARD_MUTATION_TYPES.has(TASK_TYPE.CLIPS_BUILD)).toBe(true)
  })

  it('excludes per-panel image/video tasks (they target individual rows, not the graph)', () => {
    expect(EPISODE_STORYBOARD_MUTATION_TYPES.has(TASK_TYPE.IMAGE_PANEL)).toBe(false)
    expect(EPISODE_STORYBOARD_MUTATION_TYPES.has(TASK_TYPE.VIDEO_PANEL)).toBe(false)
    expect(EPISODE_STORYBOARD_MUTATION_TYPES.has(TASK_TYPE.VOICE_LINE)).toBe(false)
  })
})

describe('episodeConflictGroupForType', () => {
  it('returns storyboard-graph for script_to_storyboard_run', () => {
    expect(episodeConflictGroupForType(TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)).toBe('storyboard-graph')
  })

  it('returns storyboard-graph for clips_build', () => {
    expect(episodeConflictGroupForType(TASK_TYPE.CLIPS_BUILD)).toBe('storyboard-graph')
  })

  it('returns null for tasks outside the matrix', () => {
    expect(episodeConflictGroupForType(TASK_TYPE.IMAGE_PANEL)).toBeNull()
    expect(episodeConflictGroupForType(TASK_TYPE.VOICE_DESIGN)).toBeNull()
    expect(episodeConflictGroupForType(TASK_TYPE.ANALYZE_NOVEL)).toBeNull()
  })
})

describe('conflictingTaskTypesForType', () => {
  it('script_to_storyboard_run conflicts with clips_build (not itself — dedupeKey already handles that)', () => {
    const conflicts = conflictingTaskTypesForType(TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)
    expect(conflicts).toContain(TASK_TYPE.CLIPS_BUILD)
    expect(conflicts).not.toContain(TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)
  })

  it('clips_build conflicts with script_to_storyboard_run (symmetric)', () => {
    const conflicts = conflictingTaskTypesForType(TASK_TYPE.CLIPS_BUILD)
    expect(conflicts).toContain(TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)
    expect(conflicts).not.toContain(TASK_TYPE.CLIPS_BUILD)
  })

  it('returns empty array for tasks outside any group', () => {
    expect(conflictingTaskTypesForType(TASK_TYPE.IMAGE_PANEL)).toEqual([])
  })
})

describe('conflict symmetry invariant', () => {
  // If A blocks B, B must block A. Otherwise one direction of the
  // race is unguarded.
  it('every conflicting pair is symmetric', () => {
    const allTypes = Object.values(TASK_TYPE)
    for (const a of allTypes) {
      const aConflicts = conflictingTaskTypesForType(a)
      for (const b of aConflicts) {
        const bConflicts = conflictingTaskTypesForType(b)
        expect(
          bConflicts.includes(a),
          `${a} blocks ${b} but ${b} does not block ${a} (asymmetric race)`,
        ).toBe(true)
      }
    }
  })
})
