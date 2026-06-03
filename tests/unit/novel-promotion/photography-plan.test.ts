/**
 * 2026-06-03 — photographyPlan must carry the UI schema.
 *
 * 4-agent audit found the cinematographer pipeline was double-schema'd: the
 * merge (orchestrator + text.worker, duplicated) mapped raw rules into
 * {composition, lighting, colorPalette, atmosphere, technicalNotes}, but the
 * editable photography UI (AIDataModal) reads {scene_summary, lighting:
 * {direction,quality}, characters[], depth_of_field, color_tone}. The two
 * never matched, so the photography editor was empty for BOTH locales (only
 * `lighting` coincidentally survived for zh). User decision: unify on the UI
 * schema. buildPhotographyPlan is the single shared mapper both merge sites
 * now use; it must pass the UI fields straight through.
 */
import { describe, expect, it } from 'vitest'
import { buildPhotographyPlan } from '@/lib/novel-promotion/photography-plan'

describe('buildPhotographyPlan', () => {
  const rule = {
    panel_number: 1,
    scene_summary: 'bedchamber, daytime',
    lighting: { direction: 'key from window right', quality: 'soft warm' },
    characters: [
      { name: 'Li', screen_position: 'frame left', posture: 'standing', facing: 'right' },
    ],
    depth_of_field: 'deep DoF (T8.0)',
    color_tone: 'warm',
  }

  it('passes the UI schema fields straight through', () => {
    const plan = buildPhotographyPlan(rule)
    expect(plan).toEqual({
      scene_summary: 'bedchamber, daytime',
      lighting: { direction: 'key from window right', quality: 'soft warm' },
      characters: [
        { name: 'Li', screen_position: 'frame left', posture: 'standing', facing: 'right' },
      ],
      depth_of_field: 'deep DoF (T8.0)',
      color_tone: 'warm',
    })
  })

  it('does NOT emit the old broken EN-merge keys', () => {
    const plan = buildPhotographyPlan(rule) as Record<string, unknown>
    expect(plan).not.toHaveProperty('composition')
    expect(plan).not.toHaveProperty('colorPalette')
    expect(plan).not.toHaveProperty('technicalNotes')
    expect(plan).not.toHaveProperty('atmosphere')
  })

  it('tolerates missing fields (returns undefined slots, never throws)', () => {
    const plan = buildPhotographyPlan({ panel_number: 2 }) as Record<string, unknown>
    expect(plan.scene_summary).toBeUndefined()
    expect(plan.color_tone).toBeUndefined()
  })
})
