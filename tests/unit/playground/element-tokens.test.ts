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
import { replaceElementNamesWithTokens } from '@/lib/playground/element-tokens'

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

  it('escapes regex-special characters in names', () => {
    expect(
      replaceElementNamesWithTokens('Mr. X (agent) appears', ['Mr. X (agent)']),
    ).toBe('<<<element_1>>> appears')
  })

  it('empty elements list is a no-op', () => {
    expect(replaceElementNamesWithTokens('anything', [])).toBe('anything')
  })
})
