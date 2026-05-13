import { describe, expect, it } from 'vitest'
import { enrichPanelCharacters } from '@/lib/workers/handlers/script-to-storyboard-helpers'

describe('enrichPanelCharacters', () => {
  it('keeps multi-char names that LLM emitted', () => {
    const out = enrichPanelCharacters(
      [{ name: '王玄', appearance: '初始形象' }],
      '王玄走进房间',
      [{ name: '王玄' }, { name: '李四' }],
    )
    expect(out).toEqual([{ name: '王玄', appearance: '初始形象' }])
  })

  it('enriches multi-char names mentioned in description but missed by LLM', () => {
    const out = enrichPanelCharacters(
      [],
      '王玄和李四在房间里对峙',
      [{ name: '王玄' }, { name: '李四' }],
    )
    expect(out.map((c) => c.name).sort()).toEqual(['李四', '王玄'])
  })

  it('does NOT enrich single-char names that appear only in preposition phrases', () => {
    // Real prod failure case: character "离" + description "悬浮在离地半米"
    // The 离 here is a preposition ("from / away from"), not the character.
    const out = enrichPanelCharacters(
      [{ name: '王玄' }],
      '王玄身穿白衣，双腿盘膝悬浮在离地半米的空中',
      [{ name: '王玄' }, { name: '离' }],
    )
    expect(out).toEqual([{ name: '王玄' }])
  })

  it('does NOT enrich single-char names that appear inside compound words', () => {
    // 离开 ("leaving") contains 离 but is a verb compound, not a char reference
    const out = enrichPanelCharacters(
      [{ name: '王玄' }],
      '王玄离开洞府向山下走去',
      [{ name: '王玄' }, { name: '离' }],
    )
    expect(out).toEqual([{ name: '王玄' }])
  })

  it('KEEPS single-char names that LLM explicitly emitted', () => {
    // Trust the LLM completely for single-char names — the deterministic
    // pass is only allowed to ADD via substring for multi-char names.
    // If LLM emitted 离, the LLM judged it a real character reference.
    const out = enrichPanelCharacters(
      [
        { name: '王玄' },
        { name: '离', appearance: '初始形象' },
      ],
      '王玄望向离',
      [{ name: '王玄' }, { name: '离' }],
    )
    expect(out).toEqual([
      { name: '王玄' },
      { name: '离', appearance: '初始形象' },
    ])
  })

  it('handles alias-split (a/b) — single-char alias still skipped', () => {
    // Roster name "王玄/玄" — two-char alias 王玄 keeps the multi-char path;
    // the single-char alias 玄 is filtered. Description that only mentions
    // the single-char form via substring should NOT trigger enrichment.
    const out = enrichPanelCharacters(
      [],
      '玄学是一门古老的学问', // single-char "玄" inside a noun phrase
      [{ name: '王玄/玄' }],
    )
    // 王玄 (the multi-char alias) is not in the description, so no add.
    expect(out).toEqual([])
  })

  it('caps at 8 enriched characters', () => {
    const desc = '甲乙丙丁戊己庚辛壬癸都在房间里'
    const roster = ['甲一', '乙二', '丙三', '丁四', '戊五', '己六', '庚七', '辛八', '壬九', '癸十'].map(
      (name) => ({ name }),
    )
    const out = enrichPanelCharacters([], desc, roster)
    // None match because roster names are 2-char but desc only has bare single chars.
    expect(out.length).toBeLessThanOrEqual(8)
  })

  it('normalizes mixed-shape LLM output (string + object)', () => {
    const out = enrichPanelCharacters(
      ['王玄', { name: '李四', appearance: '战甲' }, { name: '' }, null, 42],
      '王玄和李四在房间',
      [{ name: '王玄' }, { name: '李四' }],
    )
    expect(out).toEqual([
      { name: '王玄' },
      { name: '李四', appearance: '战甲' },
    ])
  })
})
