/**
 * Kling O3 element token replacement (2026-07-10).
 *
 * Playground Kling O3 R2V binds named subjects (人物/場景) via the
 * `elements` array; the Kling API requires the prompt to reference each
 * subject as `<<<element_N>>>` (1-based index into the elements array).
 * Users type the subject NAME in the prompt; the worker replaces names
 * with tokens server-side before submission.
 *
 * Contract locked here:
 *  - names are replaced by their 1-based array position token
 *  - longer names win over shorter prefixes (Vera vs VeraMom)
 *  - ASCII names match on word boundaries only (Vera ≠ Veranda)
 *  - CJK names substring-match (no word boundaries in Chinese)
 *  - names absent from the prompt leave the prompt untouched
 *  - every occurrence is replaced, not just the first
 */
import { describe, expect, it } from 'vitest'
import {
  buildRefImageMapSection,
  findElementNameMatches,
  replaceElementNamesWithTokens,
} from '@/lib/playground/element-tokens'

describe('findElementNameMatches (prompt highlight ranges)', () => {
  it('returns ranges with the ORIGINAL name index (for per-subject colors)', () => {
    const m = findElementNameMatches('Bob greets Alice', ['Alice', 'Bob'])
    expect(m).toEqual([
      { start: 0, end: 3, nameIndex: 1 },
      { start: 11, end: 16, nameIndex: 0 },
    ])
  })

  it('includes the leading @ in the range (it is consumed on submit)', () => {
    const m = findElementNameMatches('看 @Maeve 走', ['Maeve'])
    expect(m).toEqual([{ start: 2, end: 8, nameIndex: 0 }])
  })

  it('longer names claim overlapping text first', () => {
    const m = findElementNameMatches('VeraMom hugs Vera', ['Vera', 'VeraMom'])
    expect(m).toEqual([
      { start: 0, end: 7, nameIndex: 1 },
      { start: 13, end: 17, nameIndex: 0 },
    ])
  })

  it('ASCII names respect word boundaries; CJK substring-matches', () => {
    expect(findElementNameMatches('Vera on the Veranda', ['Vera'])).toEqual([
      { start: 0, end: 4, nameIndex: 0 },
    ])
    expect(findElementNameMatches('小美在古宅前', ['古宅'])).toEqual([
      { start: 3, end: 5, nameIndex: 0 },
    ])
  })

  it('every occurrence is returned, sorted by start', () => {
    const m = findElementNameMatches('Vera 說 Vera 好', ['Vera'])
    expect(m.map((x) => x.start)).toEqual([0, 7])
  })

  it('empty names / no hits → empty array', () => {
    expect(findElementNameMatches('nothing here', ['Vera'])).toEqual([])
    expect(findElementNameMatches('x', [])).toEqual([])
  })
})

describe('buildRefImageMapSection', () => {
  it('maps named images by 1-based position, skipping unnamed', () => {
    expect(buildRefImageMapSection([null, '客厅', 'Hayes'])).toBe(
      '參考圖對應：\nimage 2 = 「客厅」\nimage 3 = 「Hayes」',
    )
  })

  it('returns empty string when nothing is named', () => {
    expect(buildRefImageMapSection([null, undefined, '  '])).toBe('')
    expect(buildRefImageMapSection([])).toBe('')
  })

  it('trims names', () => {
    expect(buildRefImageMapSection([' Vera '])).toBe('參考圖對應：\nimage 1 = 「Vera」')
  })
})

describe('replaceElementNamesWithTokens', () => {
  it('replaces a single name with its 1-based token', () => {
    expect(replaceElementNamesWithTokens('Vera walks into the room', ['Vera']))
      .toBe('<<<element_1>>> walks into the room')
  })

  it('token index follows elements array order, not prompt order', () => {
    expect(
      replaceElementNamesWithTokens('Bob greets Alice', ['Alice', 'Bob']),
    ).toBe('<<<element_2>>> greets <<<element_1>>>')
  })

  it('longer names win over shorter prefixes', () => {
    expect(
      replaceElementNamesWithTokens('VeraMom hugs Vera', ['Vera', 'VeraMom']),
    ).toBe('<<<element_2>>> hugs <<<element_1>>>')
  })

  it('ASCII names only match whole words', () => {
    expect(
      replaceElementNamesWithTokens('Vera sits on the Veranda', ['Vera']),
    ).toBe('<<<element_1>>> sits on the Veranda')
  })

  it('CJK names substring-match inside Chinese text', () => {
    expect(
      replaceElementNamesWithTokens('小美在古宅前回頭看小美的影子', ['小美', '古宅']),
    ).toBe('<<<element_1>>>在<<<element_2>>>前回頭看<<<element_1>>>的影子')
  })

  it('replaces every occurrence', () => {
    expect(
      replaceElementNamesWithTokens('Vera runs. Vera jumps.', ['Vera']),
    ).toBe('<<<element_1>>> runs. <<<element_1>>> jumps.')
  })

  it('leaves prompt untouched when no name appears', () => {
    expect(
      replaceElementNamesWithTokens('a cat sleeps', ['Vera']),
    ).toBe('a cat sleeps')
  })

  it('swallows a leading @ before the name (storyboard-carried @Name prompts)', () => {
    // Storyboard prompts arrive as @Maeve / @客廳; the @ is not part of the
    // subject name, so replacement should consume it instead of leaving a
    // stray "@<<<element_1>>>" in the prompt. (2026-07-12)
    expect(
      replaceElementNamesWithTokens('@Maeve 走向 @客廳，Maeve 回頭', ['Maeve', '客廳']),
    ).toBe('<<<element_1>>> 走向 <<<element_2>>>，<<<element_1>>> 回頭')
  })

  it('escapes regex-special characters in names', () => {
    expect(
      replaceElementNamesWithTokens('Mr. X (agent) appears', ['Mr. X (agent)']),
    ).toBe('<<<element_1>>> appears')
  })

  it('empty elements list is a no-op', () => {
    expect(replaceElementNamesWithTokens('anything', [])).toBe('anything')
  })
})
