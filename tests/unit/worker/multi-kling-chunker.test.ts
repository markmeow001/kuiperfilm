import { describe, expect, it } from 'vitest'
import {
  buildMultiKlingSplitPlan,
  MultiKlingChunkerError,
  CHUNK_TARGET_SECONDS,
  MAX_CHUNKS_PER_DISPATCH,
} from '@/lib/workers/handlers/multi-kling-chunker'

interface Line {
  speaker: string
  content: string
}

const panel = (
  id: string,
  opts: { locationId?: string; shotType?: string } = {},
) => ({
  id,
  locationId: opts.locationId ?? 'L1',
  shotType: opts.shotType ?? 'medium',
})

describe('buildMultiKlingSplitPlan', () => {
  it('returns null when total dialogue fits in one Kling call', () => {
    const panels = [panel('p1'), panel('p2'), panel('p3')]
    const d = new Map<string, ReadonlyArray<Line>>([
      ['p1', [{ speaker: 'A', content: '短句一' }]],
      ['p2', [{ speaker: 'B', content: '短句二' }]],
      ['p3', [{ speaker: 'A', content: '短句三' }]],
    ])
    expect(buildMultiKlingSplitPlan({ panels, dialogueByPanelId: d })).toBeNull()
  })

  it('splits when total speech > budget, prefers location change cut', () => {
    // 4 panels × 5s of speech each = 20s total. With per-line buffer
    // each panel is ~5.4s. 2 panels per chunk fits target (10.8 ≤ 12.5).
    // Locations L1,L1,L2,L2 — DP should split at p2→p3.
    const longLine = '一'.repeat(20)  // 20 chars / 4 = 5s of speech
    const panels = [
      panel('p1', { locationId: 'L1' }),
      panel('p2', { locationId: 'L1' }),
      panel('p3', { locationId: 'L2' }),
      panel('p4', { locationId: 'L2' }),
    ]
    const d = new Map<string, ReadonlyArray<Line>>([
      ['p1', [{ speaker: 'A', content: longLine }]],
      ['p2', [{ speaker: 'A', content: longLine }]],
      ['p3', [{ speaker: 'B', content: longLine }]],
      ['p4', [{ speaker: 'B', content: longLine }]],
    ])
    const plan = buildMultiKlingSplitPlan({ panels, dialogueByPanelId: d })
    expect(plan).not.toBeNull()
    expect(plan!.chunks.length).toBeGreaterThanOrEqual(2)

    // The optimal cut should land at the location change. Find which
    // boundary the chunker picked.
    let cumulative = 0
    const cutAfter: number[] = []
    for (const c of plan!.chunks) {
      cumulative += c.panels.length
      cutAfter.push(cumulative)
    }
    // Should NOT span p1..p4 in one chunk, and SHOULD have a chunk
    // boundary at p2→p3 (the location cut). cutAfter contains the
    // panel count after each chunk; we expect 2 in the list (split
    // after panel 2 of 4).
    expect(cutAfter).toContain(2)
    expect(plan!.cutReasons.some((r) => r === 'location-change')).toBe(true)
  })

  it('throws SINGLE_PANEL_OVER_BUDGET when one panel alone > 15s', () => {
    const tooLong = '一'.repeat(80) // 80 chars / 4 = 20s
    const panels = [panel('p1'), panel('p2')]
    const d = new Map<string, ReadonlyArray<Line>>([
      ['p1', [{ speaker: 'A', content: tooLong }]],
    ])
    expect(() => buildMultiKlingSplitPlan({ panels, dialogueByPanelId: d })).toThrow(
      /SINGLE_PANEL_OVER_BUDGET/,
    )
  })

  it('throws EXCEEDS_DISPATCH_LIMIT for very long dialogue', () => {
    // 6 panels × ~10s each = 60s of dialogue. Even with optimal
    // splitting, that's at least 4 chunks > MAX_CHUNKS_PER_DISPATCH (3).
    const tenSec = '一'.repeat(40) // 40 chars / 4 = 10s
    const panels = Array.from({ length: 6 }, (_, i) => panel(`p${i + 1}`))
    const d = new Map<string, ReadonlyArray<Line>>(
      panels.map((p) => [p.id, [{ speaker: 'A', content: tenSec }]] as const),
    )
    expect(() => buildMultiKlingSplitPlan({ panels, dialogueByPanelId: d })).toThrow(
      /EXCEEDS_DISPATCH_LIMIT/,
    )
  })

  it('every chunk has totalDuration ≤ 15 and ≤ 6 panels', () => {
    // 5 panels × ~5s each = 25s, easy 2-chunk split.
    const fiveSec = '一'.repeat(20) // 20 chars / 4 = 5s
    const panels = Array.from({ length: 5 }, (_, i) => panel(`p${i + 1}`))
    const d = new Map<string, ReadonlyArray<Line>>(
      panels.map((p) => [p.id, [{ speaker: 'A', content: fiveSec }]] as const),
    )
    const plan = buildMultiKlingSplitPlan({ panels, dialogueByPanelId: d })
    expect(plan).not.toBeNull()
    for (const c of plan!.chunks) {
      expect(c.totalDuration).toBeLessThanOrEqual(15)
      expect(c.panels.length).toBeLessThanOrEqual(6)
      expect(c.durations.reduce((a, b) => a + b, 0)).toBe(c.totalDuration)
    }
  })

  it('preserves panel order across chunks', () => {
    const fiveSec = '一'.repeat(20)
    const panels = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => panel(id))
    const d = new Map<string, ReadonlyArray<Line>>(
      panels.map((p) => [p.id, [{ speaker: 'A', content: fiveSec }]] as const),
    )
    const plan = buildMultiKlingSplitPlan({ panels, dialogueByPanelId: d })
    expect(plan).not.toBeNull()
    const flat = plan!.chunks.flatMap((c) => c.panels.map((p) => p.id))
    expect(flat).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('respects target seconds — chunks aim under 12s of speech', () => {
    // 3 panels × 3s = 9s + 3 × 0.4s buffer = 10.2s. Fits the 12s target.
    const threeSec = '一'.repeat(12) // 12 chars / 4 = 3s
    const panels = ['p1', 'p2', 'p3'].map((id) => panel(id))
    const d = new Map<string, ReadonlyArray<Line>>(
      panels.map((p) => [p.id, [{ speaker: 'A', content: threeSec }]] as const),
    )
    const plan = buildMultiKlingSplitPlan({ panels, dialogueByPanelId: d })
    // Under target — should fit, returns null.
    expect(plan).toBeNull()
  })

  it('exposes the score and cut reasons for telemetry', () => {
    // 4 panels × 5s; same shape as the location-cut test so a split
    // is required and we exercise the score/reasons path.
    const fiveSec = '一'.repeat(20)
    const panels = [
      panel('p1', { locationId: 'L1' }),
      panel('p2', { locationId: 'L1' }),
      panel('p3', { locationId: 'L2' }),
      panel('p4', { locationId: 'L2' }),
    ]
    const d = new Map<string, ReadonlyArray<Line>>(
      panels.map((p) => [p.id, [{ speaker: 'A', content: fiveSec }]] as const),
    )
    const plan = buildMultiKlingSplitPlan({ panels, dialogueByPanelId: d })
    expect(plan).not.toBeNull()
    expect(typeof plan!.score).toBe('number')
    expect(plan!.cutReasons.length).toBeGreaterThan(0)
  })

  it('honors targetSeconds override', () => {
    // 2 panels × 6s of speech = 12s + 0.8s buffer = 12.8s.
    // panelTotal = ceil(6.4)*2 = 14, fits Kling's 15s cap.
    const sixSec = '一'.repeat(24)
    const panels = [panel('p1'), panel('p2')]
    const d = new Map<string, ReadonlyArray<Line>>(
      panels.map((p) => [p.id, [{ speaker: 'A', content: sixSec }]] as const),
    )
    // With looser 20s target both panels fit in a single Kling call.
    expect(
      buildMultiKlingSplitPlan({
        panels,
        dialogueByPanelId: d,
        targetSeconds: 20,
      }),
    ).toBeNull()
    // With strict 8s target the 12.8s pair exceeds the budget; one
    // panel per chunk fits (6.4s ≤ 8.5s) so we end up with 2 chunks.
    const strict = buildMultiKlingSplitPlan({
      panels,
      dialogueByPanelId: d,
      targetSeconds: 8,
    })
    expect(strict).not.toBeNull()
    expect(strict!.chunks.length).toBe(2)
  })

  it('exports CHUNK_TARGET_SECONDS and MAX_CHUNKS_PER_DISPATCH', () => {
    expect(CHUNK_TARGET_SECONDS).toBe(12)
    expect(MAX_CHUNKS_PER_DISPATCH).toBe(3)
  })

  it('MultiKlingChunkerError is throwable with a typed code', () => {
    const err = new MultiKlingChunkerError('TOO_MANY_PANELS', 'msg')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('TOO_MANY_PANELS')
  })
})
