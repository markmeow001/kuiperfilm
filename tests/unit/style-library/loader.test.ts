import { describe, expect, it, vi } from 'vitest'
import {
  buildVisualStyleNegative,
  buildVisualStylePrefix,
  buildVisualStyleSuffix,
  getLightingSafe,
  getStyleSafe,
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
  // Phase J (2026-05-21) — NULL visualStyleId now falls back to
  // DEFAULT_PROJECT_VISUAL_STYLE_ID (cinematic_realism) instead of
  // returning null. Pre-Phase-J tests that locked "returns null" are
  // inverted here. The fallback ensures the realism anchor reaches
  // the model for the entire legacy NULL cohort without needing a
  // production DB backfill UPDATE.
  it('falls back to cinematic_realism when project visualStyleId is NULL (Phase J)', async () => {
    const out = await resolveProjectVisualStyle(makePrismaStub({ visualStyleId: null, lightingPresetId: null }), 'p1')
    expect(out).not.toBeNull()
    expect(out!.style.id).toBe('cinematic_realism')
  })

  it('falls back to cinematic_realism when project row is missing (Phase J)', async () => {
    const out = await resolveProjectVisualStyle(makePrismaStub(null), 'p1')
    expect(out).not.toBeNull()
    expect(out!.style.id).toBe('cinematic_realism')
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

  it('respects a non-NULL user choice (does NOT override with default)', async () => {
    // Phase J fallback ONLY kicks in for NULL/missing. A user who
    // explicitly picked 港式電影 (hk_cinema) keeps their pick — a
    // backfill UPDATE would silently override and is explicitly out
    // of scope. Only the fallback path defaults to realism.
    const out = await resolveProjectVisualStyle(
      makePrismaStub({ visualStyleId: 'hk_cinema', lightingPresetId: null }),
      'p1',
    )
    expect(out!.style.id).toBe('hk_cinema')
  })

  it('falls back to cinematic_realism on unknown styleId (Phase J — was: returns null)', async () => {
    // Unknown DB value (e.g. user picked a style we later removed)
    // resolves to default rather than null. AVOID list + prefix/suffix
    // always ship — silent absence is harder to debug than a
    // deterministic fallback.
    const out = await resolveProjectVisualStyle(
      makePrismaStub({ visualStyleId: 'definitely_not_a_real_style_id', lightingPresetId: null }),
      'p1',
    )
    expect(out).not.toBeNull()
    expect(out!.style.id).toBe('cinematic_realism')
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

describe('safe lookups (Phase E override path)', () => {
  it('getStyleSafe returns the entry for a known id', () => {
    const out = getStyleSafe('cinematic_realism')
    expect(out).not.toBeNull()
    expect(out!.nameZh).toBe('院線寫實')
  })

  it('getStyleSafe returns null for an unknown id (no throw)', () => {
    expect(getStyleSafe('not_a_real_style')).toBeNull()
  })

  it('getLightingSafe returns the entry for a known id', () => {
    const out = getLightingSafe('golden_hour')
    expect(out).not.toBeNull()
    expect(out!.id).toBe('golden_hour')
  })

  it('getLightingSafe returns null for an unknown id (no throw)', () => {
    expect(getLightingSafe('not_a_real_lighting')).toBeNull()
  })
})
