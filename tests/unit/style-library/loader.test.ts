import { describe, expect, it, vi } from 'vitest'
import {
  buildVisualStyleNegative,
  buildVisualStylePrefix,
  buildVisualStyleSuffix,
  resolveProjectVisualStyle,
} from '@/lib/style-library/loader'

function makePrismaStub(row: { visualStyleId: string | null; lightingPresetId: string | null } | null) {
  return {
    novelPromotionProject: {
      findUnique: vi.fn().mockResolvedValue(row),
    },
  } as unknown as Parameters<typeof resolveProjectVisualStyle>[0]
}

describe('resolveProjectVisualStyle', () => {
  it('returns null when project has no visualStyleId', async () => {
    const out = await resolveProjectVisualStyle(makePrismaStub({ visualStyleId: null, lightingPresetId: null }), 'p1')
    expect(out).toBeNull()
  })

  it('returns null when project row is missing', async () => {
    const out = await resolveProjectVisualStyle(makePrismaStub(null), 'p1')
    expect(out).toBeNull()
  })

  it('resolves a known styleId from the curated catalog', async () => {
    const out = await resolveProjectVisualStyle(
      makePrismaStub({ visualStyleId: 'cinematic_realism', lightingPresetId: null }),
      'p1',
    )
    expect(out).not.toBeNull()
    expect(out!.style.id).toBe('cinematic_realism')
    expect(out!.style.nameZh).toBe('院線寫實')
    expect(out!.lighting).toBeNull()
  })

  it('attaches a lighting preset when provided', async () => {
    const out = await resolveProjectVisualStyle(
      makePrismaStub({ visualStyleId: 'cinematic_realism', lightingPresetId: 'golden_hour' }),
      'p1',
    )
    expect(out!.lighting?.id).toBe('golden_hour')
  })

  it('returns null on unknown styleId rather than throwing', async () => {
    const out = await resolveProjectVisualStyle(
      makePrismaStub({ visualStyleId: 'definitely_not_a_real_style_id', lightingPresetId: null }),
      'p1',
    )
    expect(out).toBeNull()
  })
})

describe('build helpers', () => {
  it('returns empty strings when resolved is null (regression-safe)', () => {
    expect(buildVisualStylePrefix(null)).toBe('')
    expect(buildVisualStyleSuffix(null)).toBe('')
    expect(buildVisualStyleNegative(null)).toBe('')
  })

  it('builds prefix containing styleAnchor and lighting override', async () => {
    const out = await resolveProjectVisualStyle(
      makePrismaStub({ visualStyleId: 'cinematic_realism', lightingPresetId: 'golden_hour' }),
      'p1',
    )
    const prefix = buildVisualStylePrefix(out)
    expect(prefix).toContain('Cinematic photorealistic style')
    expect(prefix.endsWith('. ')).toBe(true)
  })

  it('builds suffix containing visual modifiers', async () => {
    const out = await resolveProjectVisualStyle(
      makePrismaStub({ visualStyleId: 'cinematic_realism', lightingPresetId: null }),
      'p1',
    )
    const suffix = buildVisualStyleSuffix(out)
    expect(suffix).toContain('shallow depth of field')
    expect(suffix.startsWith(' ')).toBe(true)
  })

  it('builds negative joining style + lighting negatives', async () => {
    const out = await resolveProjectVisualStyle(
      makePrismaStub({ visualStyleId: 'cinematic_realism', lightingPresetId: 'golden_hour' }),
      'p1',
    )
    const neg = buildVisualStyleNegative(out)
    expect(neg).toContain('animation')
    expect(neg.split(',').length).toBeGreaterThan(1)
  })
})
