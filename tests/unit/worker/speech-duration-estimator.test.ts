import { describe, expect, it } from 'vitest'
import {
  estimateSpeechSeconds,
  estimatePanelSpeechSeconds,
  buildDialogueDrivenDurations,
  computeGroupRecommendedDurationSec,
} from '@/lib/workers/handlers/speech-duration-estimator'

describe('estimateSpeechSeconds', () => {
  it('returns 0 for empty string', () => {
    expect(estimateSpeechSeconds('')).toBe(0)
    expect(estimateSpeechSeconds('   ')).toBe(0)
  })

  it('estimates Chinese chars at the configured CJK rate', () => {
    // 8 chars / 4 chars/sec = 2s
    expect(estimateSpeechSeconds('你好我是新角色介紹')).toBeCloseTo(9 / 4, 5)
  })

  it('estimates English words at the configured rate', () => {
    // 6 words / 2.3 wps ≈ 2.61s
    expect(estimateSpeechSeconds('hello there how are you today')).toBeCloseTo(6 / 2.3, 4)
  })

  it('handles mixed CJK + English by summing both', () => {
    // 3 CJK chars (0.75s) + 3 words (1.30s) ≈ 2.05s
    const sec = estimateSpeechSeconds('你好嗎 hello there friend')
    expect(sec).toBeGreaterThan(1.9)
    expect(sec).toBeLessThan(2.2)
  })
})

describe('estimatePanelSpeechSeconds', () => {
  it('sums all lines and adds per-line buffer', () => {
    const lines = [
      { speaker: 'A', content: '你好嗎' }, // 3 chars / 4 = 0.75s
      { speaker: 'B', content: 'hello world' }, // 2 words / 2.3 ≈ 0.87s
    ]
    // 0.75 + 0.87 + 2 × 0.4 buffer = ~2.42s
    const sec = estimatePanelSpeechSeconds(lines)
    expect(sec).toBeGreaterThan(2.3)
    expect(sec).toBeLessThan(2.6)
  })

  it('returns 0 for empty lines array', () => {
    expect(estimatePanelSpeechSeconds([])).toBe(0)
    expect(estimatePanelSpeechSeconds(undefined)).toBe(0)
  })
})

describe('buildDialogueDrivenDurations', () => {
  it('returns null when no panel has dialogue', () => {
    const panels = [{ id: 'p1' }, { id: 'p2' }]
    const dialogue = new Map<string, ReadonlyArray<{ speaker: string; content: string }>>()
    expect(buildDialogueDrivenDurations({ panels, dialogueByPanelId: dialogue })).toBeNull()
  })

  it('gives silent panels the floor and dialogue panels their estimated time', () => {
    const panels = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
    // 12 chars ≈ 3s + buffer ≈ 3.4s → ceil to 4s
    const dialogue = new Map([
      [
        'p2',
        [{ speaker: 'A', content: '這是一段中等長度的對白測' }],
      ],
    ])
    const r = buildDialogueDrivenDurations({ panels, dialogueByPanelId: dialogue })
    expect(r).not.toBeNull()
    expect(r!.durations).toHaveLength(3)
    expect(r!.durations[0]).toBe(3) // silent floor
    expect(r!.durations[1]).toBeGreaterThanOrEqual(4) // dialogue estimate
    expect(r!.durations[2]).toBe(3) // silent floor
    expect(r!.totalDuration).toBe(r!.durations.reduce((a, b) => a + b, 0))
  })

  it('throws DIALOGUE_EXCEEDS_KLING_BUDGET when speech alone exceeds 15s', () => {
    const panels = [{ id: 'p1' }, { id: 'p2' }]
    // 80 CJK chars = 20s of speech alone
    const longLine = '一'.repeat(80)
    const dialogue = new Map([
      ['p1', [{ speaker: 'A', content: longLine }]],
    ])
    expect(() =>
      buildDialogueDrivenDurations({ panels, dialogueByPanelId: dialogue }),
    ).toThrow(/DIALOGUE_EXCEEDS_KLING_BUDGET/)
  })

  it('shrinks silent-panel padding when integer rounding pushes total > 15s', () => {
    // 6 panels, two with dialogue summing to ~12s, four silent. Default
    // floor would push total = 12 + 4×3 = 24 > 15. The shrink pass cuts
    // silent panels to 1s each so total drops to 12 + 4 = 16 still over,
    // then 12 + 1+1+1+0 — but min is 1. Realistically this case will
    // throw DIALOGUE_EXCEEDS because dialogue alone is fine but total
    // budget is exhausted by silent floors.
    const panels = [
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
      { id: 'p4' },
      { id: 'p5' },
      { id: 'p6' },
    ]
    // p1 dialogue ≈ 1s, p2 dialogue ≈ 1s, others silent.
    const dialogue = new Map([
      ['p1', [{ speaker: 'A', content: '短句一句' }]], // ~1s
      ['p2', [{ speaker: 'B', content: '另一句也是短的' }]], // ~1.5s
    ])
    const r = buildDialogueDrivenDurations({ panels, dialogueByPanelId: dialogue })
    expect(r).not.toBeNull()
    expect(r!.totalDuration).toBeLessThanOrEqual(15)
  })

  it('preserves caller-controlled silentPanelSeconds when provided', () => {
    const panels = [{ id: 'p1' }, { id: 'p2' }]
    const dialogue = new Map([
      ['p1', [{ speaker: 'A', content: '一句話' }]],
    ])
    const r = buildDialogueDrivenDurations({
      panels,
      dialogueByPanelId: dialogue,
      silentPanelSeconds: 1,
    })
    expect(r!.durations[1]).toBe(1)
  })
})

describe('computeGroupRecommendedDurationSec', () => {
  it('returns null for empty panels (caller decides empty-state UI)', () => {
    expect(computeGroupRecommendedDurationSec([])).toBeNull()
  })

  it('uses dialogue-driven total when srtSegment carries speech', () => {
    // Two short dialogue lines → driven total under 15s ceiling.
    const result = computeGroupRecommendedDurationSec([
      { id: 'p1', srtSegment: 'Karrug: 你還好嗎' },
      { id: 'p2', srtSegment: 'Ayla: 我沒事' },
    ])
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0)
    expect(result!).toBeLessThanOrEqual(15)
  })

  it('handles "：" full-width colon, not just half-width ":"', () => {
    const result = computeGroupRecommendedDurationSec([
      { id: 'p1', srtSegment: '旁白：森林深處傳來腳步聲' },
    ])
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0)
  })

  it('falls back to Phase M baseline when every panel is silent', () => {
    // 3 silent panels → baseline = max(10, 3*2.5)=10, clamped 4-15 → 10s.
    const result = computeGroupRecommendedDurationSec([
      { id: 'p1' },
      { id: 'p2', srtSegment: '' },
      { id: 'p3', srtSegment: null },
    ])
    expect(result).toBe(10)
  })

  it('clamps the baseline to 15s even with many silent panels', () => {
    // 10 silent panels → baseline = max(10, 10*2.5)=25, clamped → 15s.
    const panels = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }))
    const result = computeGroupRecommendedDurationSec(panels)
    expect(result).toBe(15)
  })

  it('treats no-colon srtSegment as narration (still has dialogue)', () => {
    const result = computeGroupRecommendedDurationSec([
      { id: 'p1', srtSegment: '一個沒有冒號的句子也算對白' },
    ])
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0)
  })
})

describe('computeGroupRecommendedDurationSec — targetSecPerGroup (2026-05-22)', () => {
  // Bug context: 《迁徙》ep3 hit 95s for a 180s target because the silent-
  // group fallback was a hard-coded 10s regardless of project ambition.
  // The new option lets the caller pass the per-group fair share derived
  // from project.targetDuration / groupCount.

  it('uses targetSecPerGroup as floor for silent groups (replaces 10s default)', () => {
    // target=180s / 12 groups = 15s/group share. 2 silent panels → panel
    // floor = 5. Baseline = max(15, 5) = 15, clamp [4,15] = 15.
    const result = computeGroupRecommendedDurationSec(
      [{ id: 'p1' }, { id: 'p2' }],
      { targetSecPerGroup: 15 },
    )
    expect(result).toBe(15)
  })

  it('honors a sub-10s target share when user picks a short total', () => {
    // target=80s / 10 groups = 8s share. 2 silent panels → panel floor 5.
    // baseline = max(8, 5) = 8. Without the target option this would have
    // been a hard-coded 10s.
    const result = computeGroupRecommendedDurationSec(
      [{ id: 'p1' }, { id: 'p2' }],
      { targetSecPerGroup: 8 },
    )
    expect(result).toBe(8)
  })

  it('panel-count floor still wins when groups are dense', () => {
    // 8 panels * 2.5 = 20s panel floor. target share is 5s. Take the max,
    // then clamp to 15. Dense groups don't shrink just because target is low.
    const result = computeGroupRecommendedDurationSec(
      Array.from({ length: 8 }, (_, i) => ({ id: `p${i}` })),
      { targetSecPerGroup: 5 },
    )
    expect(result).toBe(15)
  })

  it('still clamps high target shares to the 15s Seedance ceiling', () => {
    // target=300s / 5 groups = 60s share. Hard-capped to 15s per group.
    const result = computeGroupRecommendedDurationSec(
      [{ id: 'p1' }, { id: 'p2' }],
      { targetSecPerGroup: 60 },
    )
    expect(result).toBe(15)
  })

  it('null targetSecPerGroup preserves legacy 10s default', () => {
    // 1 silent panel — panel floor 2.5 → baseline = max(10 legacy, 2.5) = 10.
    const result = computeGroupRecommendedDurationSec(
      [{ id: 'p1' }],
      { targetSecPerGroup: null },
    )
    expect(result).toBe(10)
  })

  it('dialogue-driven duration overrides target floor', () => {
    // Long dialogue should drive duration, not the target share.
    const longLine = 'A: ' + '對白'.repeat(15)
    const result = computeGroupRecommendedDurationSec(
      [{ id: 'p1', srtSegment: longLine }],
      { targetSecPerGroup: 5 },
    )
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(5)
  })

  it('《迁徙》 ep3 silent-group case: 21 panels / 10 groups → each silent group hits 15s with target 180', () => {
    // Real prod regression — 21 panels in 10 groups, target 180s → share
    // 18 per group → clamp 15. With this fix, total = 10*15 = 150s
    // (vs broken 10*10 = 100s before). Up from ~53% to ~83% of target.
    const groupOf2Silent = [{ id: 'a' }, { id: 'b' }]
    const result = computeGroupRecommendedDurationSec(groupOf2Silent, {
      targetSecPerGroup: 18,
    })
    expect(result).toBe(15)
  })
})
