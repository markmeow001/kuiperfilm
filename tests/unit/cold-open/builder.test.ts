import { describe, expect, it } from 'vitest'
import {
  buildColdOpenShotBlock,
  fitPanelsToFourSlots,
  type ColdOpenPanel,
} from '@/lib/cold-open'

const PER_SHOT_TAG =
  '(live-action photography, real grain, real skin texture, candid motion, NO CG, NO animation)'
const ANTI_TEXT_LINE = 'STRICT: no on-screen text, no subtitles, no logos, no screen UI of any kind.'

function makePanel(overrides: Partial<ColdOpenPanel> = {}): ColdOpenPanel {
  return {
    id: overrides.id ?? 'panel-default',
    description: overrides.description ?? '',
    characters: overrides.characters ?? null,
    location: overrides.location ?? null,
    voiceLines: overrides.voiceLines,
    srtSegment: overrides.srtSegment ?? null,
  }
}

describe('fitPanelsToFourSlots', () => {
  it('returns empty when no panels supplied', () => {
    expect(fitPanelsToFourSlots([])).toEqual([])
  })

  it('passes through exactly 4 panels unchanged', () => {
    const panels = [
      makePanel({ id: 'a' }),
      makePanel({ id: 'b' }),
      makePanel({ id: 'c' }),
      makePanel({ id: 'd' }),
    ]
    const out = fitPanelsToFourSlots(panels)
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('pads short groups by repeating the last panel', () => {
    const panels = [makePanel({ id: 'a' }), makePanel({ id: 'b' })]
    const out = fitPanelsToFourSlots(panels)
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'b', 'b'])
  })

  it('trims long groups keeping first 3 and last (preserves climax)', () => {
    const panels = [
      makePanel({ id: 'a' }),
      makePanel({ id: 'b' }),
      makePanel({ id: 'c' }),
      makePanel({ id: 'd' }),
      makePanel({ id: 'e' }),
      makePanel({ id: 'climax' }),
    ]
    const out = fitPanelsToFourSlots(panels)
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c', 'climax'])
  })
})

describe('buildColdOpenShotBlock', () => {
  it('returns empty string when no panels', () => {
    const out = buildColdOpenShotBlock({
      panels: [],
      variant: 'modern',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    expect(out).toBe('')
  })

  it('emits exactly 4 shot blocks at 2-second intervals', () => {
    const panels = [
      makePanel({ id: '1', description: '咖啡廳內，女主擦著桌子' }),
      makePanel({ id: '2', description: '神秘男子推門而入' }),
      makePanel({ id: '3', description: '兩人四目相對' }),
      makePanel({ id: '4', description: '女主臉色驟變' }),
    ]
    const out = buildColdOpenShotBlock({
      panels,
      variant: 'modern',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    expect(out).toContain('镜头1（0-2 seconds）')
    expect(out).toContain('镜头2（2-4 seconds）')
    expect(out).toContain('镜头3（4-6 seconds）')
    expect(out).toContain('镜头4（6-8 seconds）')
    // 4 shot titles + 1 hook header
    const blocks = out.split('\n\n')
    expect(blocks.length).toBe(5)
  })

  it('always ends shot 4 with slow push-in regardless of variant', () => {
    for (const variant of ['modern', 'period', 'action'] as const) {
      const out = buildColdOpenShotBlock({
        panels: [makePanel({ description: '一個鏡頭' })],
        variant,
        perShotTag: PER_SHOT_TAG,
        antiTextLine: ANTI_TEXT_LINE,
      })
      expect(out).toContain('Camera: slow push in')
    }
  })

  it('uses STUNNED FACE for modern variant', () => {
    const out = buildColdOpenShotBlock({
      panels: [makePanel({ description: 'x' })],
      variant: 'modern',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    expect(out).toContain('STUNNED FACE')
  })

  it('uses DETERMINED FACE for period variant', () => {
    const out = buildColdOpenShotBlock({
      panels: [makePanel({ description: 'x' })],
      variant: 'period',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    expect(out).toContain('DETERMINED FACE')
  })

  it('uses SHOCKED FACE for action variant', () => {
    const out = buildColdOpenShotBlock({
      panels: [makePanel({ description: 'x' })],
      variant: 'action',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    expect(out).toContain('SHOCKED FACE')
  })

  it('places first dialogue on shot 3 (over-shoulder beat)', () => {
    const panels = [
      makePanel({
        id: '1',
        description: 'opening',
        voiceLines: [{ speaker: '女主', content: '你是誰？', isVoiceover: false }],
      }),
      makePanel({ id: '2' }),
      makePanel({ id: '3' }),
      makePanel({ id: '4' }),
    ]
    const out = buildColdOpenShotBlock({
      panels,
      variant: 'modern',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    const blocks = out.split('\n\n')
    // blocks[0] = hookHeader, blocks[1..4] = 镜头1..4
    expect(blocks[3]).toContain('女主: "你是誰？"')
    expect(blocks[1]).not.toContain('女主: "你是誰？"')
    expect(blocks[2]).not.toContain('女主: "你是誰？"')
  })

  it('promotes any dialogue to voiceover format on shot 4 when no VO line exists', () => {
    const panels = [
      makePanel({
        id: '1',
        voiceLines: [{ speaker: '男主', content: '其實我是億萬富翁', isVoiceover: false }],
      }),
      makePanel({ id: '2' }),
      makePanel({ id: '3' }),
      makePanel({ id: '4' }),
    ]
    const out = buildColdOpenShotBlock({
      panels,
      variant: 'modern',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    const blocks = out.split('\n\n')
    expect(blocks[4]).toContain('Voiceover (off-camera, lips do not move) — 男主: "其實我是億萬富翁"')
  })

  it('prefers a VO-tagged line over a regular dialogue for shot 4', () => {
    const panels = [
      makePanel({
        voiceLines: [{ speaker: '女主', content: '尋常一句', isVoiceover: false }],
      }),
      makePanel({
        voiceLines: [{ speaker: '旁白', content: '她不知道命運即將翻轉', isVoiceover: true }],
      }),
      makePanel(),
      makePanel(),
    ]
    const out = buildColdOpenShotBlock({
      panels,
      variant: 'modern',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    const blocks = out.split('\n\n')
    expect(blocks[4]).toContain('旁白: "她不知道命運即將翻轉"')
    expect(blocks[4]).toContain('Voiceover (off-camera, lips do not move)')
  })

  it('emits cast and scene binding lines per shot', () => {
    const panel = makePanel({
      id: '1',
      description: '一個女子站在房間',
      characters: [{ name: '女主' }, { name: '男主' }],
      location: '咖啡廳#1',
    })
    const out = buildColdOpenShotBlock({
      panels: [panel],
      variant: 'modern',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    expect(out).toContain('[Cast: 女主、男主] [Scene: 咖啡廳]')
  })

  it('appends anti-horror line to the push-in shot only', () => {
    const out = buildColdOpenShotBlock({
      panels: [makePanel({ description: 'x' })],
      variant: 'modern',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    const blocks = out.split('\n\n')
    expect(blocks[4]).toContain('not a horror movie')
    expect(blocks[1]).not.toContain('not a horror movie')
    expect(blocks[2]).not.toContain('not a horror movie')
    expect(blocks[3]).not.toContain('not a horror movie')
  })

  it('emits PER_SHOT_TAG and ANTI_TEXT_LINE in every shot block', () => {
    const out = buildColdOpenShotBlock({
      panels: [makePanel({ description: 'x' })],
      variant: 'modern',
      perShotTag: PER_SHOT_TAG,
      antiTextLine: ANTI_TEXT_LINE,
    })
    const occurrences = (haystack: string, needle: string) =>
      haystack.split(needle).length - 1
    expect(occurrences(out, PER_SHOT_TAG)).toBe(4)
    expect(occurrences(out, ANTI_TEXT_LINE)).toBe(4)
  })
})
