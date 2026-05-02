import { describe, expect, it } from 'vitest'
import {
  buildBPathCustomizePrompts,
  distributeShotDurations,
  KLING_OMNI_DEFAULT_PER_SHOT_DURATION,
  KLING_OMNI_MAX_TOTAL_DURATION,
  KLING_OMNI_MAX_SHOTS,
} from '@/lib/workers/handlers/multi-shot-video-b-path'

const panel = (id: string, opts: { description?: string | null; videoPrompt?: string | null }) => ({
  id,
  description: opts.description ?? null,
  videoPrompt: opts.videoPrompt ?? null,
})

describe('distributeShotDurations', () => {
  it('hands out KLING_OMNI_DEFAULT_PER_SHOT_DURATION per shot when caller passes nothing', () => {
    const r = distributeShotDurations(3, undefined)
    expect(r.durations).toEqual([3, 3, 3])
    expect(r.totalDuration).toBe(9)
  })

  it('caps the per-shot default at the model ceiling for ≥6 shots', () => {
    // 6 × 3 = 18 would exceed 15. We expect base = floor(15/6) = 2 with
    // 3 extra seconds spread to the first three shots → 3,3,3,2,2,2.
    const r = distributeShotDurations(KLING_OMNI_MAX_SHOTS, undefined)
    expect(r.totalDuration).toBe(KLING_OMNI_MAX_TOTAL_DURATION)
    expect(r.durations).toHaveLength(KLING_OMNI_MAX_SHOTS)
    expect(r.durations.reduce((a, b) => a + b, 0)).toBe(KLING_OMNI_MAX_TOTAL_DURATION)
    expect(Math.min(...r.durations)).toBeGreaterThanOrEqual(1)
  })

  it('honours caller-supplied per-shot durations when valid', () => {
    const r = distributeShotDurations(5, [2, 2, 3, 2, 3])
    expect(r.durations).toEqual([2, 2, 3, 2, 3])
    expect(r.totalDuration).toBe(12)
  })

  it('rejects mismatched length', () => {
    expect(() => distributeShotDurations(3, [2, 3])).toThrow('PANEL_DURATIONS_LENGTH_MISMATCH')
  })

  it('rejects total > 15 (model max)', () => {
    expect(() => distributeShotDurations(5, [4, 4, 4, 4, 4])).toThrow('TOTAL_DURATION_EXCEEDS_LIMIT')
  })

  it('rejects per-shot duration < 1', () => {
    expect(() => distributeShotDurations(3, [1, 0.5, 1])).toThrow('PANEL_DURATION_INVALID')
  })

  it('rejects > 6 shots (Kling cap)', () => {
    expect(() => distributeShotDurations(7, undefined)).toThrow('SHOT_COUNT_TOO_MANY')
  })

  it('rejects 0 shots', () => {
    expect(() => distributeShotDurations(0, undefined)).toThrow('SHOT_COUNT_INVALID')
  })

  it('uses default per-shot when explicit total fits but caller asks default-mode (no array)', () => {
    expect(distributeShotDurations(2, undefined).totalDuration).toBe(2 * KLING_OMNI_DEFAULT_PER_SHOT_DURATION)
  })
})

describe('buildBPathCustomizePrompts', () => {
  it('emits 1-based index, dialogue-aware prompt, and matching duration per shot', () => {
    const panels = [
      panel('p1', { videoPrompt: '中景：男子起床' }),
      panel('p2', { videoPrompt: '全景：女友端早餐进门' }),
    ]
    const dialogues = new Map([
      ['p2', [{ speaker: '陳雅婷', content: '志明，你還好嗎？' }]],
    ])
    const out = buildBPathCustomizePrompts(panels, dialogues, [3, 4])
    expect(out).toEqual([
      { index: 1, prompt: '中景：男子起床', duration: 3 },
      { index: 2, prompt: '全景：女友端早餐进门\n陳雅婷: "志明，你還好嗎？"', duration: 4 },
    ])
  })

  it('drops empty shots and re-numbers index so Kling sees a compact 1..N sequence', () => {
    const panels = [
      panel('p1', { videoPrompt: '中景：男子起床' }),
      panel('p2', { videoPrompt: null, description: null }),  // dropped
      panel('p3', { videoPrompt: '近景：闹钟' }),
    ]
    const out = buildBPathCustomizePrompts(panels, new Map(), [2, 2, 3])
    // p2's slot is gone — output is two entries indexed 1, 2 (NOT 1, 3).
    // Customize mode requires compact indices; the runtime caller must
    // also recompute Duration as the sum of remaining durations.
    expect(out.map((e) => e.index)).toEqual([1, 2])
    expect(out.map((e) => e.duration)).toEqual([2, 3])
  })

  it('throws when panels and durations have different lengths', () => {
    const panels = [panel('p1', { videoPrompt: 'A' })]
    expect(() => buildBPathCustomizePrompts(panels, new Map(), [2, 3])).toThrow(
      'PANEL_DURATION_PAIRING_MISMATCH',
    )
  })

  it('returns empty array when every panel is empty (caller must throw on this)', () => {
    const panels = [
      panel('p1', { videoPrompt: null, description: null }),
      panel('p2', { videoPrompt: '   ', description: '' }),
    ]
    const out = buildBPathCustomizePrompts(panels, new Map(), [3, 3])
    expect(out).toEqual([])
  })
})
