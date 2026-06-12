import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PanelGenerationMode } from '@prisma/client'

/**
 * Phase 1.5A schema contract (REDESIGN_PLAN §1.5A).
 *
 * The R2V-first 4-mode fields are dormant until Phase 1.5C wires the
 * worker routing. This contract pins two invariants so nothing drifts
 * in between:
 *
 * 1. The PanelGenerationMode enum has exactly the 4 agreed modes.
 * 2. The DB default stays `direct_t2v` — `prisma db push` applies the
 *    default to every EXISTING row, so a default of r2v_with_subjects
 *    would silently flip all legacy panels onto the R2V path the moment
 *    1.5C ships. The r2v_with_subjects default for NEW panels belongs at
 *    the creation sites (Phase 1.5C), not in the DB.
 */

const EXPECTED_MODES = [
  'direct_t2v',
  'r2v_with_subjects',
  't2i_then_i2v',
  'r2v_with_motion_ref',
] as const

const PHASE_1_5A_FIELDS = [
  'generationMode',
  'sceneContext',
  'motionLine',
  'keyframeUrl',
  'keyframeCandidates',
  'r2vMotionRefUrl',
  'perShotProvider',
] as const

function loadPanelModelBlock(): string {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
  const match = schema.match(/model NovelPromotionPanel \{[\s\S]*?\n\}/)
  if (!match) throw new Error('NovelPromotionPanel model not found in schema.prisma')
  return match[0]
}

describe('Phase 1.5A — PanelGenerationMode schema contract', () => {
  it('generated client exposes exactly the 4 agreed modes', () => {
    expect(Object.keys(PanelGenerationMode).sort()).toEqual([...EXPECTED_MODES].sort())
  })

  it('NovelPromotionPanel declares all 7 Phase 1.5A fields', () => {
    const model = loadPanelModelBlock()
    for (const field of PHASE_1_5A_FIELDS) {
      expect(model, `missing field ${field}`).toMatch(new RegExp(`\\n\\s+${field}\\s`))
    }
  })

  it('generationMode DB default stays direct_t2v (legacy rows must not flip to R2V)', () => {
    const model = loadPanelModelBlock()
    expect(model).toMatch(
      /generationMode\s+PanelGenerationMode\s+@default\(direct_t2v\)/,
    )
  })
})
