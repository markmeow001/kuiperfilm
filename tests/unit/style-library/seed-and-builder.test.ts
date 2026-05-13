/**
 * Style library seed + prompt builder smoke tests.
 *
 * Locks in the contract from docs/style-library-seed/README.md:
 *   - 29 visual styles across 7 categories (A=5 B=6 C=5 D=3 E=3 F=4 G=3)
 *   - 8 lighting presets
 *   - prompt builder emits Style Bible per shot (no drift)
 *   - VOD request shape includes EnhancePrompt='Disabled' (Tencent
 *     prompt-rewrite is the documented style-drift culprit)
 */

import { describe, expect, it } from 'vitest'
import {
  visualStyles,
  lightingPresets,
  getStyle,
  getLighting,
  buildKlingPrompt,
  buildShortDramaShots,
  buildVodAigcRequest,
  buildVclmRequest,
} from '@/lib/style-library'

describe('style library seed', () => {
  it('contains exactly 29 visual styles', () => {
    expect(visualStyles).toHaveLength(29)
  })

  it('splits styles into categories A=5 B=6 C=5 D=3 E=3 F=4 G=3', () => {
    const byCategory = visualStyles.reduce<Record<string, number>>((acc, s) => {
      acc[s.category] = (acc[s.category] ?? 0) + 1
      return acc
    }, {})
    expect(byCategory).toEqual({ A: 5, B: 6, C: 5, D: 3, E: 3, F: 4, G: 3 })
  })

  it('contains exactly 8 lighting presets', () => {
    expect(lightingPresets).toHaveLength(8)
  })

  it('every style has non-empty styleAnchor + visualModifiers + negativePrompt', () => {
    for (const s of visualStyles) {
      expect(s.styleAnchor.length, `${s.id} styleAnchor`).toBeGreaterThan(0)
      expect(s.visualModifiers.length, `${s.id} visualModifiers`).toBeGreaterThan(0)
      expect(s.negativePrompt.length, `${s.id} negativePrompt`).toBeGreaterThan(0)
    }
  })

  it('every style id is unique snake_case', () => {
    const ids = new Set<string>()
    for (const s of visualStyles) {
      expect(s.id, `duplicate id ${s.id}`).not.toBe('')
      expect(ids.has(s.id), `duplicate id ${s.id}`).toBe(false)
      ids.add(s.id)
      expect(s.id).toMatch(/^[a-z0-9_]+$/)
    }
  })
})

describe('prompt builder', () => {
  it('getStyle / getLighting return seeded entries', () => {
    expect(getStyle('cinematic_realism').nameZh).toBe('院線寫實')
    expect(getLighting('golden_hour').nameZh).toBe('黃金時刻')
  })

  it('throws on unknown id (no silent fallback per design)', () => {
    expect(() => getStyle('does-not-exist')).toThrow()
    expect(() => getLighting('does-not-exist')).toThrow()
  })

  it('buildKlingPrompt wraps userContent with styleAnchor + visualModifiers', () => {
    const { prompt, negativePrompt } = buildKlingPrompt({
      userContent: 'Two characters argue on a rooftop at sunset',
      styleId: 'cinematic_realism',
      lightingId: 'golden_hour',
    })
    expect(prompt.startsWith('Cinematic photorealistic style')).toBe(true)
    expect(prompt).toContain('Two characters argue on a rooftop at sunset')
    expect(prompt).toContain('golden hour sunset lighting')
    // Style Bible — visualModifiers always at tail.
    expect(prompt.endsWith('color-graded for theatrical release')).toBe(true)
    expect(negativePrompt).toContain('animation')
    expect(negativePrompt).toContain('harsh midday sun')
  })

  it('buildShortDramaShots repeats the Style Bible on EVERY shot (no drift)', () => {
    const result = buildShortDramaShots({
      shots: [
        { description: 'Shot one: he looks up.', duration: 3 },
        { description: 'Shot two: she looks back.', duration: 3 },
        { description: 'Shot three: they kiss.', duration: 4 },
      ],
      styleId: 'cinematic_realism',
    })
    expect(result.shots).toHaveLength(3)
    for (const shot of result.shots) {
      // Style Bible — styleAnchor must appear in every shot prompt.
      expect(shot.prompt).toContain('Cinematic photorealistic style')
      expect(shot.prompt).toContain('color-graded for theatrical release')
    }
    // Default stability negatives are appended.
    expect(result.negativePrompt).toContain('no style drift')
  })

  it('buildVodAigcRequest hardcodes EnhancePrompt=Disabled (anti-drift contract)', () => {
    const req = buildVodAigcRequest({
      subAppId: 12345,
      shots: [{ description: 'A single shot.', duration: 5 }],
      styleId: 'cinematic_realism',
    })
    expect(req.EnhancePrompt).toBe('Disabled')
    expect(req.ModelName).toBe('Kling')
    expect(req.ModelVersion).toBe('3.0-Omni')
    expect(req.OutputConfig.AspectRatio).toBe('9:16')
    expect(req.OutputConfig.Duration).toBe(5)
  })

  it('buildVodAigcRequest packs elementIds via ExtInfo.AdditionalParameters (double-encoded)', () => {
    const req = buildVodAigcRequest({
      subAppId: 1,
      shots: [{ description: 'A.', duration: 3 }],
      styleId: 'cinematic_realism',
      elementIds: ['elem-a', 'elem-b'],
    })
    expect(typeof req.ExtInfo).toBe('string')
    const parsed = JSON.parse(req.ExtInfo as string)
    const inner = JSON.parse(parsed.AdditionalParameters as string)
    expect(inner.element_list).toEqual([{ element_id: 'elem-a' }, { element_id: 'elem-b' }])
  })

  it('buildVclmRequest maps 3.0-Omni → kling-v3-omni and clamps Duration into [3,10]', () => {
    const req = buildVclmRequest({
      shots: [
        { description: 'Shot 1', duration: 5 },
        { description: 'Shot 2', duration: 5 },
        { description: 'Shot 3', duration: 5 }, // total 15 → clamp to 10
      ],
      styleId: 'cinematic_realism',
    })
    expect(req.Model).toBe('kling-v3-omni')
    expect(req.Duration).toBe(10)
    expect(req.MultiShot).toBe(true)
    expect(req.ShotType).toBe('customize')
  })
})
