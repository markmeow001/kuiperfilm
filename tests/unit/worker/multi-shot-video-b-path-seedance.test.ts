import { describe, expect, it } from 'vitest'
import { buildSeedancePrompt } from '@/lib/workers/handlers/multi-shot-video-b-path'

const panel = (
  id: string,
  opts: {
    description?: string | null
    videoPrompt?: string | null
    characters?: string | null
    location?: string | null
    shotType?: string | null
    cameraMove?: string | null
  },
) => ({
  id,
  description: opts.description ?? null,
  videoPrompt: opts.videoPrompt ?? null,
  characters: opts.characters ?? null,
  location: opts.location ?? null,
  shotType: opts.shotType ?? null,
  cameraMove: opts.cameraMove ?? null,
})

describe('buildSeedancePrompt', () => {
  it('produces time-indexed segments with scene + character tags', () => {
    const panels = [
      panel('p1', {
        description: '近景：劉浩怒吼',
        characters: JSON.stringify([{ name: '劉浩' }]),
        location: '废弃工业区_破晓',
        cameraMove: '急速推近',
      }),
      panel('p2', {
        description: '中景：劉浩拔刀撲向陳子豪',
        characters: JSON.stringify([{ name: '劉浩' }, { name: '陳子豪' }]),
        location: '废弃工业区_破晓',
        cameraMove: '手持跟随',
      }),
    ]
    const out = buildSeedancePrompt(panels, new Map())
    // Default 3s per panel
    expect(out).toContain('0-3 seconds:')
    expect(out).toContain('3-6 seconds:')
    expect(out).toContain('[废弃工业区_破晓]')
    expect(out).toContain('[劉浩]')
    expect(out).toContain('[陳子豪]')
    expect(out).toContain('近景：劉浩怒吼')
    expect(out).toContain('(急速推近)')
    expect(out).toContain('(手持跟随)')
    expect(out.split('\n\n').length).toBe(2)
  })

  it('embeds dialogue inline as [speaker]: "line"', () => {
    const panels = [
      panel('p1', {
        description: '近景：劉浩怒吼',
        characters: JSON.stringify([{ name: '劉浩' }]),
        location: '工业区',
      }),
    ]
    const dialogues = new Map([['p1', [{ speaker: '劉浩', content: '操！' }]]])
    const out = buildSeedancePrompt(panels, dialogues)
    expect(out).toContain('[劉浩]: "操！"')
  })

  it('strips #viewHint from location tag', () => {
    const panels = [panel('p1', { description: 'A', location: '客廳#窗邊' })]
    const out = buildSeedancePrompt(panels, new Map())
    expect(out).toContain('[客廳]')
    expect(out).not.toContain('#窗邊')
  })

  it('uses videoPrompt when description is missing (priority preserved from buildShotBody)', () => {
    const panels = [panel('p1', { videoPrompt: 'fallback motion', description: null })]
    const out = buildSeedancePrompt(panels, new Map())
    expect(out).toContain('fallback motion')
  })

  it('drops empty panels and recomputes time slices around them', () => {
    const panels = [
      panel('p1', { description: 'first shot' }),
      panel('p2', { description: null, videoPrompt: null }), // dropped
      panel('p3', { description: 'third shot' }),
    ]
    const out = buildSeedancePrompt(panels, new Map())
    // Only 2 segments; default 3s/each, total 6s
    expect(out.split('\n\n').length).toBe(2)
    expect(out).toContain('0-3 seconds:')
    expect(out).toContain('3-6 seconds:')
    expect(out).toContain('first shot')
    expect(out).toContain('third shot')
  })

  it('honours caller-supplied per-shot durations', () => {
    const panels = [
      panel('p1', { description: 'A', characters: JSON.stringify([{ name: 'X' }]) }),
      panel('p2', { description: 'B', characters: JSON.stringify([{ name: 'Y' }]) }),
      panel('p3', { description: 'C', characters: JSON.stringify([{ name: 'Z' }]) }),
    ]
    const out = buildSeedancePrompt(panels, new Map(), [2, 5, 3])
    expect(out).toContain('0-2 seconds:')
    expect(out).toContain('2-7 seconds:')
    expect(out).toContain('7-10 seconds:')
  })

  it('omits scene tag and the trailing dash when location is missing', () => {
    const panels = [
      panel('p1', { description: 'A', characters: JSON.stringify([{ name: 'X' }]) }),
    ]
    const out = buildSeedancePrompt(panels, new Map())
    // Without a scene tag the segment goes straight from the time
    // marker to the character tag (no leading "[scene] -" preamble).
    expect(out).toBe('0-3 seconds: [X] A')
    expect(out).not.toContain(' - [X]')
  })

  it('returns empty string when every panel is empty (caller throws on this)', () => {
    const panels = [
      panel('p1', { description: null, videoPrompt: null }),
      panel('p2', { description: '   ', videoPrompt: null }),
    ]
    expect(buildSeedancePrompt(panels, new Map())).toBe('')
  })

  it('caps total time at 15s when caller did not specify (model max)', () => {
    const panels = Array.from({ length: 6 }, (_, i) => panel(`p${i + 1}`, { description: `shot ${i + 1}` }))
    const out = buildSeedancePrompt(panels, new Map())
    // 6 × 3 = 18 would exceed 15. distributeShotDurations gives 3,3,3,2,2,2.
    expect(out).toMatch(/13-15 seconds:/)
  })
})
