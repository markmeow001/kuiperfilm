/**
 * Phase 2.5 Step 4-A — apply-defaults priority contract.
 *
 * Priority: payload (user-supplied) > skill.defaults > undefined.
 * Pure function — no IO, no mocks needed.
 */
import { describe, expect, it } from 'vitest'
import { applySkillDefaultsToPayload } from '@/lib/skills/apply-defaults'
import type { SkillConfig } from '@/lib/skills/types'

function makeConfig(overrides: Partial<SkillConfig['defaults']> = {}): SkillConfig {
  return {
    version: 1,
    input: {},
    pipeline: [{ stage: 'generate_panel_video', model: 'ark::seedance-2.0' }],
    defaults: {
      aspectRatio: '9:16',
      durationPerShotSec: 10,
      shotCount: 3,
      resolution: '1080p',
      ...overrides,
    },
  }
}

describe('applySkillDefaultsToPayload', () => {
  it('keeps user-supplied value when payload explicitly sets a field', () => {
    const result = applySkillDefaultsToPayload(
      { aspectRatio: '16:9', resolution: '4k' },
      makeConfig(),
    )
    expect(result.aspectRatio).toBe('16:9')
    expect(result.resolution).toBe('4k')
  })

  it('fills aspectRatio from defaults when payload omits it', () => {
    const result = applySkillDefaultsToPayload({}, makeConfig())
    expect(result.aspectRatio).toBe('9:16')
    expect(result.resolution).toBe('1080p')
  })

  it('derives totalDurationSeconds from durationPerShotSec × shotCount when omitted', () => {
    const result = applySkillDefaultsToPayload({}, makeConfig())
    expect(result.totalDurationSeconds).toBe(30)
  })

  it('does NOT derive totalDurationSeconds when payload already set it', () => {
    const result = applySkillDefaultsToPayload({ totalDurationSeconds: 60 }, makeConfig())
    expect(result.totalDurationSeconds).toBe(60)
  })

  it('does NOT derive totalDurationSeconds when defaults missing duration or shotCount', () => {
    const result = applySkillDefaultsToPayload(
      {},
      makeConfig({ durationPerShotSec: undefined }),
    )
    expect(result.totalDurationSeconds).toBeUndefined()
  })

  it('fills visualStyleId from defaults when payload omits it', () => {
    const result = applySkillDefaultsToPayload(
      {},
      makeConfig({ visualStyleId: 'cinematic_realism' }),
    )
    expect(result.visualStyleId).toBe('cinematic_realism')
  })

  it('keeps payload videoModel untouched (apply-defaults does NOT touch model)', () => {
    const result = applySkillDefaultsToPayload(
      { videoModel: 'fal::seedance-2.0' },
      makeConfig(),
    )
    expect(result.videoModel).toBe('fal::seedance-2.0')
  })

  it('does not mutate the input payload', () => {
    const payload: Record<string, unknown> = { aspectRatio: '16:9' }
    const result = applySkillDefaultsToPayload(payload, makeConfig())
    expect(payload).toEqual({ aspectRatio: '16:9' })
    expect(result).not.toBe(payload)
  })
})
