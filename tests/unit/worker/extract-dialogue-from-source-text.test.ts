import { describe, expect, it } from 'vitest'
import { extractDialogueFromSourceText } from '@/lib/workers/handlers/script-to-storyboard-helpers'

describe('extractDialogueFromSourceText — bare colon dialogue', () => {
  it('extracts a single CJK speaker line', () => {
    expect(extractDialogueFromSourceText('长官：把那片星域抹除')).toBe('长官: 把那片星域抹除')
  })

  it('extracts ALL-CAPS Latin speaker', () => {
    expect(extractDialogueFromSourceText('TOBY: Mamá, estás tapando la luz')).toBe(
      'TOBY: Mamá, estás tapando la luz',
    )
  })

  it('returns null for empty / whitespace input', () => {
    expect(extractDialogueFromSourceText('')).toBeNull()
    expect(extractDialogueFromSourceText('   \n  \t')).toBeNull()
    expect(extractDialogueFromSourceText(null)).toBeNull()
    expect(extractDialogueFromSourceText(undefined)).toBeNull()
  })

  it('returns null when no colon-shaped dialogue exists', () => {
    expect(
      extractDialogueFromSourceText('极端特写：红色的警报灯外壳纹理在红光中若隐若现'),
    ).toBeNull()
  })
})

describe('extractDialogueFromSourceText — 《迁徙》 ep3 regression (2026-05-22)', () => {
  // Real prod script lines from ep3 of project 4f067c87. Before the
  // 2026-05-22 fix, 5/6 produced srtSegment=NULL because the parens
  // modifier after the speaker name broke the colon regex. Seedance R2V
  // then generated silent lip-sync video.

  it('extracts speaker with parenthetical modifier (失真、卡顿)', () => {
    const src = 'AI 系统广播（失真、卡顿）： "Warning. Illegal emotional fluctuation detected... Infection source... spreading."'
    const result = extractDialogueFromSourceText(src)
    expect(result).toContain('AI 系统广播:')
    expect(result).toContain('Warning. Illegal emotional fluctuation detected')
  })

  it('extracts speaker with single-word parens modifier (冷酷)', () => {
    const src = '长官（冷酷）： "Erase that sector, along with the signal."'
    const result = extractDialogueFromSourceText(src)
    expect(result).toContain('长官:')
    expect(result).toContain('Erase that sector')
  })

  it('extracts ALL-CAPS Latin speaker with parens modifier', () => {
    const src = 'ZARA（广播声音，穿透杂讯）： "They say we\'re defective... that we\'re already dead!"'
    const result = extractDialogueFromSourceText(src)
    expect(result).toContain('ZARA:')
    expect(result).toContain("They say we're defective")
  })

  it('extracts single-char CJK speaker with comma-list parens modifier', () => {
    const src = '镜（怒吼，伴随引擎轰鸣）： "The system is lying!!"'
    const result = extractDialogueFromSourceText(src)
    expect(result).toContain('镜:')
    expect(result).toContain('The system is lying')
  })

  it('extracts speaker with no parens modifier (mixed shape compatibility)', () => {
    const src = 'AI 系统广播： "Target locked. Ten, nine, eight..."'
    const result = extractDialogueFromSourceText(src)
    expect(result).toContain('AI 系统广播:')
    expect(result).toContain('Target locked')
  })

  it('extracts 少年 (3 CJK char speaker) with parens modifier', () => {
    const src = '少年（嘶喊）： "Let them hear we are alive!!"'
    const result = extractDialogueFromSourceText(src)
    expect(result).toContain('少年:')
    expect(result).toContain('Let them hear we are alive')
  })
})

describe('extractDialogueFromSourceText — audio metadata false-positives', () => {
  // Without the AUDIO_METADATA_KEYWORDS denylist, parenthetical sound
  // notes like `（音效：尖锐的单音蜂鸣）` slipped into srtSegment as fake
  // dialogue from speaker 音效. Real bug observed on panel 1 of《迁徙》ep3.

  it('rejects 音效: as a speaker', () => {
    expect(extractDialogueFromSourceText('音效: 尖锐的单音蜂鸣')).toBeNull()
  })

  it('rejects 配乐: / 音乐: / BGM: / SFX: shaped labels', () => {
    expect(extractDialogueFromSourceText('配乐: 极具侵略性的重金属工业合成器')).toBeNull()
    expect(extractDialogueFromSourceText('音乐: 紧张感持续累积')).toBeNull()
    expect(extractDialogueFromSourceText('BGM: industrial synth crescendo')).toBeNull()
    expect(extractDialogueFromSourceText('SFX: Braam')).toBeNull()
  })

  it('rejects 字幕: / 旁白: metadata labels', () => {
    expect(extractDialogueFromSourceText('字幕: WHAT THE SYSTEM FEARS MOST')).toBeNull()
    expect(extractDialogueFromSourceText('旁白: 故事就这样开始了')).toBeNull()
  })

  it('extracts real dialogue while rejecting embedded audio metadata', () => {
    const src = '长官（冷酷）：把那片星域抹除。 音效: 金属重击 Braam'
    const result = extractDialogueFromSourceText(src)
    // 长官 line extracted; 音效 segment dropped (rejected head)
    expect(result).toContain('长官:')
    expect(result).toContain('把那片星域抹除')
    expect(result).not.toContain('音效:')
  })
})

describe('extractDialogueFromSourceText — compound camera term rejection', () => {
  // SCENE_SUFFIXES denylist catches `X+镜头/特写/近景/全景/...` compounds
  // that the original exact-match denylist missed.

  it('rejects 对话镜头: prefix (compound camera term)', () => {
    expect(extractDialogueFromSourceText('对话镜头: 长官嘴唇机械开合')).toBeNull()
  })

  it('rejects 极端特写: prefix', () => {
    expect(extractDialogueFromSourceText('极端特写: 红色的警报灯外壳纹理')).toBeNull()
  })

  it('rejects 跟拍中景: prefix', () => {
    expect(extractDialogueFromSourceText('跟拍中景: 镜在维修层狂奔')).toBeNull()
  })

  it('rejects 建立镜头: but keeps real dialogue in same string', () => {
    const src = '建立镜头：ZARA 站在广播控制台前。ZARA（颤抖）：他们说我们是瑕疵品。'
    const result = extractDialogueFromSourceText(src)
    expect(result).not.toContain('建立镜头:')
    expect(result).toContain('ZARA:')
    expect(result).toContain('他们说我们是瑕疵品')
  })
})

describe('extractDialogueFromSourceText — historical TOBY/CATHERINE regression', () => {
  // Preserve coverage of the original 17b1f037 prod bug shape — mixed
  // scene narration + dialogue in the same source_text.

  it('extracts CATHERINE: line from inside scene description', () => {
    const src = '特写: 一个插着"45"数字蜡烛的蛋糕被端上桌。CATHERINE: ¡Sorpresa!'
    const result = extractDialogueFromSourceText(src)
    expect(result).toContain('CATHERINE:')
    expect(result).toContain('¡Sorpresa')
    expect(result).not.toContain('特写:')
  })

  it('drops a "scene description with BRUCE(丈夫) as definite article" pattern', () => {
    // BRUCE(丈夫)盯着 — BRUCE is followed by parens (modifier), then 盯着
    // (no colon). So no dialogue head matches. Should return null.
    const src = '全景: 餐桌上一片死寂。BRUCE(丈夫)盯着平板，沒人看蛋糕一眼'
    expect(extractDialogueFromSourceText(src)).toBeNull()
  })

  it('rejects 编号3 / 编号 N speaker prefixes', () => {
    expect(extractDialogueFromSourceText('编号3 TOBY 戴着大耳机')).toBeNull()
  })
})
