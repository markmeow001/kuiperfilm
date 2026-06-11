/**
 * Phase 2.5 Step 4-B — official Skills model contract.
 *
 * Every official Skill's `pipeline[].model` MUST resolve through
 * `parseModelKeyStrict`. If a Skill author pins a retired model id or
 * a typo'd vendor prefix, this contract test fails at CI BEFORE the
 * Skill row ships to prod and every workflow on that Skill silently
 * falls through to the generic path.
 *
 * Catches the failure mode described in plan §R-B3 (retired model)
 * and §R-X2 (Skill ↔ catalog drift at CI time).
 */
import { describe, expect, it } from 'vitest'
import { OFFICIAL_SKILLS } from '@/lib/skills/official-skills'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { resolveSkillConfigFromRaw } from '@/lib/skills/server'

describe('official Skills — pinned models are parseable', () => {
  for (const skill of OFFICIAL_SKILLS) {
    describe(`Skill: ${skill.slug}`, () => {
      it('config shape is valid (passes resolveSkillConfigFromRaw)', () => {
        expect(() => resolveSkillConfigFromRaw(skill.config, skill.slug)).not.toThrow()
      })

      for (const stage of skill.config.pipeline) {
        if (!stage.model) continue
        it(`stage '${stage.stage}' model '${stage.model}' resolves via parseModelKeyStrict`, () => {
          const parsed = parseModelKeyStrict(stage.model)
          expect(parsed, `Skill ${skill.slug} stage ${stage.stage} pinned model "${stage.model}" did not parse — typo or retired model`).not.toBeNull()
          expect(parsed?.provider).toBeTruthy()
          expect(parsed?.modelId).toBeTruthy()
        })
      }
    })
  }
})
