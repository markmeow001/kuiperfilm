/**
 * Regression for 2026-05-28 — "on-screen speaker rendered as voice-over".
 *
 * agent_storyboard_plan lets multiple shots SHARE one source_text. srtSegment
 * used to be extracted per-panel from that shared text, so every shot (incl.
 * an action / reaction shot) inherited EVERY speaker's line. A shot framing
 * William then carried Kent's line, but Seedance only lip-syncs on-screen
 * faces → Kent rendered as a voice-over.
 *
 * attributeDialogueToPanels() routes each spoken line to the panel that
 * FRAMES its speaker, deduped across the group, and keeps genuinely
 * off-screen speakers as voice-over on the first panel that carries them.
 */
import { describe, expect, it } from 'vitest'
import {
  attributeDialogueToPanels,
  extractDialogueLinesFromSourceText,
  normalizeSpeakerName,
} from '@/lib/workers/handlers/script-to-storyboard-helpers'

describe('normalizeSpeakerName', () => {
  it('is case-insensitive and strips whitespace', () => {
    expect(normalizeSpeakerName('Kent')).toBe(normalizeSpeakerName('KENT'))
    expect(normalizeSpeakerName('  Kent ')).toBe('kent')
  })

  it('drops parentheticals and VO/OS modifiers so 桃桃（VO） matches 桃桃', () => {
    expect(normalizeSpeakerName('桃桃（VO）')).toBe(normalizeSpeakerName('桃桃'))
    expect(normalizeSpeakerName('王玄 O.S.')).toBe(normalizeSpeakerName('王玄'))
  })
})

describe('extractDialogueLinesFromSourceText', () => {
  it('returns structured speaker/content for every dialogue head', () => {
    const lines = extractDialogueLinesFromSourceText('Vera: hello there. Kent: only two weeks!')
    expect(lines).toEqual([
      { speaker: 'Vera', content: 'hello there.' },
      { speaker: 'Kent', content: 'only two weeks!' },
    ])
  })

  it('returns [] for pure narration (no dialogue heads)', () => {
    expect(extractDialogueLinesFromSourceText('William 站在浴池入口下。')).toEqual([])
  })
})

describe('attributeDialogueToPanels — dialogue goes to the shot that frames the speaker', () => {
  it('routes each speaker line to their own shot; the action shot stays silent', () => {
    // 3 shots SHARE the same paragraph. Shot 0 frames William (action),
    // shot 1 frames Vera, shot 2 frames Kent.
    const shared = 'William 仰头饮尽。Vera: blood pact now. Kent: only two weeks!'
    const out = attributeDialogueToPanels([
      { sourceText: shared, framedNames: ['William De Ville'] },
      { sourceText: shared, framedNames: ['Vera'] },
      { sourceText: shared, framedNames: ['Kent'] },
    ])
    expect(out[0]).toBeNull() // William action shot — no borrowed VO
    expect(out[1]).toBe('Vera: blood pact now.')
    expect(out[2]).toBe('Kent: only two weeks!')
  })

  it('does NOT duplicate a line across multiple shots sharing source_text', () => {
    const shared = 'Vera: blood pact now. Kent: only two weeks!'
    const out = attributeDialogueToPanels([
      { sourceText: shared, framedNames: ['Vera'] },
      { sourceText: shared, framedNames: ['Kent'] },
    ])
    expect(out[0]).toBe('Vera: blood pact now.')
    expect(out[1]).toBe('Kent: only two weeks!')
  })

  it('keeps a genuinely off-screen speaker as voice-over on the listener shot', () => {
    // 桃桃 is intentionally NOT framed; the shot frames 王玄 reacting. The
    // （VO） modifier is stripped from the speaker head by the extractor.
    const out = attributeDialogueToPanels([
      { sourceText: '桃桃（VO）: 爸爸快来救救妈妈。王玄猛然睁眼。', framedNames: ['王玄'] },
    ])
    expect(out[0]).toBe('桃桃: 爸爸快来救救妈妈。王玄猛然睁眼。')
  })

  it('matches speaker to framed name case-insensitively', () => {
    const out = attributeDialogueToPanels([
      { sourceText: 'KENT: only two weeks!', framedNames: ['Kent'] },
    ])
    expect(out[0]).toBe('KENT: only two weeks!')
  })

  it("all-William group: no Vera/Kent shot → their lines stay as VO on the first shot, not duplicated", () => {
    // Documents the user's exact case. When the group has no shot framing
    // the speaker, the line falls back to VO on the FIRST carrier (not
    // copied onto all three). Speaker on-screen presence then depends on
    // a dedicated speaker shot existing elsewhere in the storyboard.
    const shared = 'William 仰头饮尽。Vera: blood pact. Kent: two weeks!'
    const out = attributeDialogueToPanels([
      { sourceText: shared, framedNames: ['William De Ville'] },
      { sourceText: shared, framedNames: ['William De Ville'] },
      { sourceText: shared, framedNames: ['William De Ville'] },
    ])
    expect(out[0]).toBe('Vera: blood pact.\nKent: two weeks!')
    expect(out[1]).toBeNull()
    expect(out[2]).toBeNull()
  })
})
