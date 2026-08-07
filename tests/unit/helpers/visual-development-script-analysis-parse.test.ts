import { describe, expect, it } from 'vitest'
import { parseScriptAnalysisModelOutput } from '@/lib/visual-development/script-analysis'

function modelOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    synopsis: '一個關於身體恐怖的故事。',
    characters: [
      { code: 'ANNA', name: '安娜', aliases: ['小安'] },
    ],
    ...overrides,
  })
}

function parse(text: string) {
  return parseScriptAnalysisModelOutput({
    text,
    id: 'analysis-1',
    sourceTitle: '閉環',
    sourceFormat: 'pasted',
    sourceLength: 6856,
    modelKey: 'openrouter:gemini-3.1-pro',
    analyzedAt: '2026-08-06T00:00:00.000Z',
  })
}

describe('parseScriptAnalysisModelOutput free-form lists', () => {
  it('drops junk items in aliases instead of failing the whole analysis', () => {
    const result = parse(modelOutput({
      characters: [
        { code: 'ANNA', name: '安娜', aliases: [null, '小安', '', 42, { nested: 'x' }, '  阿安  '] },
      ],
    }))
    expect(result.characters[0].aliases).toEqual(['小安', '42', '阿安'])
  })

  it('accepts a bare string where the model should have returned a list', () => {
    const result = parse(modelOutput({ themes: '身體恐怖' }))
    expect(result.themes).toEqual(['身體恐怖'])
  })

  it('drops junk items in themes and confidenceNotes', () => {
    const result = parse(modelOutput({
      themes: ['身體焦慮', null, ''],
      confidenceNotes: [null, '第三幕篇幅推測'],
    }))
    expect(result.themes).toEqual(['身體焦慮'])
    expect(result.confidenceNotes).toContain('第三幕篇幅推測')
  })

  it('still rejects structurally wrong list values', () => {
    expect(() => parse(modelOutput({ themes: { theme: '物件不是列表' } })))
      .toThrow('SCRIPT_ANALYSIS_INVALID: themes must be an array')
  })

  it('caps list length after filtering junk', () => {
    const aliases = [null, ...Array.from({ length: 30 }, (_v, i) => `別名${i}`)]
    const result = parse(modelOutput({
      characters: [{ code: 'ANNA', name: '安娜', aliases }],
    }))
    expect(result.characters[0].aliases).toHaveLength(20)
    expect(result.characters[0].aliases[0]).toBe('別名0')
  })
})
