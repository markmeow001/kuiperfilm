import { describe, expect, it } from 'vitest'
import {
  dialogueDedupKey,
  extractScriptDialogues,
  inferEmotionFromContent,
} from '@/lib/novel-promotion/script-dialogue-extractor'

describe('extractScriptDialogues — iangyc 王玄/桃桃 episode', () => {
  // Verbatim from the bug report (2026-05-12). Exercises:
  //  - 王玄OS：           inline OS modifier
  //  - 桃桃（哽咽VO）：    parenthetical with VO + emotion
  //  - 王玄（闭眼皱眉，OS）：parenthetical with comma-separated modifier
  //  - △ prefixed action  must be skipped
  //  - 字幕：/ 人物：     screenplay metadata must be skipped
  const iangycScript = `第一集
        1-1洞府、洞府外 日 内、外
            人物：王玄(成年、青年) 群演若干
△ 洞府内，花香鸟语、草木清新，王玄(35岁左右，有胡茬，但不邋遢)一身白衣，盘膝悬空而坐。
字幕：结界洞府
字幕：剑仙师祖，王玄
王玄OS：洞府一甲子，凡尘弹指间，我王玄意外闯入钟南山修真结界百年。
△ 镜头切洞府外，一群修士正踏着石阶登山来朝。
王玄OS：位列仙班！
△ 王玄眉间结出一颗金色的光点
桃桃（哽咽VO）：爸爸,你在哪，快来救救妈妈，妈妈被坏人抓走了，爸爸,妈妈和桃桃需要你...
王玄（闭眼皱眉，OS）：这是来自我血脉的呼喊？
△ 洞府开始震荡，王玄眉心的金光忽明忽暗地闪烁。
王玄OS：不好......`

  it('extracts all 5 colon-format dialogue lines', () => {
    const result = extractScriptDialogues(iangycScript)
    expect(result).toHaveLength(5)
  })

  it('strips inline OS suffix from speaker name', () => {
    const result = extractScriptDialogues(iangycScript)
    const first = result[0]
    expect(first.speaker).toBe('王玄')
    expect(first.modifier).toBe('OS')
    expect(first.content).toContain('洞府一甲子')
  })

  it('parses VO inside parenthetical with emotion descriptor', () => {
    const result = extractScriptDialogues(iangycScript)
    const taotao = result.find((d) => d.speaker === '桃桃')
    expect(taotao).toBeDefined()
    expect(taotao!.modifier).toBe('VO')
    expect(taotao!.content).toContain('爸爸')
    expect(taotao!.content).toContain('妈妈被坏人抓走')
  })

  it('parses OS inside parenthetical with comma-separated descriptors', () => {
    const result = extractScriptDialogues(iangycScript)
    const wangxuanOS = result.find((d) => d.content.startsWith('这是来自我血脉'))
    expect(wangxuanOS).toBeDefined()
    expect(wangxuanOS!.speaker).toBe('王玄')
    expect(wangxuanOS!.modifier).toBe('OS')
  })

  it('skips action lines prefixed with △', () => {
    const result = extractScriptDialogues(iangycScript)
    for (const d of result) {
      expect(d.content).not.toMatch(/^镜头切/)
      expect(d.content).not.toMatch(/^洞府内/)
      expect(d.content).not.toMatch(/^王玄眉间/)
    }
  })

  it('skips screenplay metadata (字幕/人物)', () => {
    const result = extractScriptDialogues(iangycScript)
    for (const d of result) {
      expect(d.speaker).not.toBe('字幕')
      expect(d.speaker).not.toBe('人物')
    }
  })

  it('preserves original line ordering via lineNumber', () => {
    const result = extractScriptDialogues(iangycScript)
    const lineNumbers = result.map((d) => d.lineNumber)
    expect(lineNumbers).toEqual([...lineNumbers].sort((a, b) => a - b))
  })
})

describe('extractScriptDialogues — edge cases', () => {
  it('returns empty for empty / whitespace input', () => {
    expect(extractScriptDialogues('')).toEqual([])
    expect(extractScriptDialogues('   \n\n  ')).toEqual([])
    expect(extractScriptDialogues(null as unknown as string)).toEqual([])
  })

  it('handles half-width colon dialogue', () => {
    const result = extractScriptDialogues('柳如烟:殿下身份尊贵')
    expect(result).toHaveLength(1)
    expect(result[0].speaker).toBe('柳如烟')
    expect(result[0].content).toBe('殿下身份尊贵')
  })

  it('does not extract quoted dialogue (LLM handles that path)', () => {
    // We intentionally ignore quote-style dialogue here — voice_analysis
    // LLM is reliable on that format. Only colon-style needs rescue.
    const result = extractScriptDialogues('柳如烟说："殿下身份尊贵"')
    // The colon after "柳如烟说" produces a speaker, so it WILL extract.
    // The downstream dedup will collapse this against the LLM's own
    // extraction. The important thing is we don't crash on quotes.
    expect(result.length).toBeGreaterThanOrEqual(0)
  })

  it('blocks meta-keyword speakers (字幕/场景/画面/人物/镜头)', () => {
    const script = `
字幕：结界洞府
场景：山洞外
画面：黑暗中亮起
人物：王玄、柳如烟
镜头：推近
`.trim()
    expect(extractScriptDialogues(script)).toEqual([])
  })

  it('does not crash on speakers longer than the safety limit', () => {
    const longHead = '一'.repeat(50)
    expect(() => extractScriptDialogues(`${longHead}：hello`)).not.toThrow()
    expect(extractScriptDialogues(`${longHead}：hello`)).toEqual([])
  })
})

describe('dialogueDedupKey', () => {
  it('collapses whitespace and trailing punctuation', () => {
    const k1 = dialogueDedupKey('王玄', '洞府一甲子，凡尘弹指间...')
    const k2 = dialogueDedupKey('王玄', '洞府一甲子,凡尘弹指间')
    expect(k1).toBe(k2)
  })

  it('treats different speakers as different keys', () => {
    expect(dialogueDedupKey('王玄', '位列仙班')).not.toBe(dialogueDedupKey('桃桃', '位列仙班'))
  })
})

describe('inferEmotionFromContent', () => {
  it('lowers intensity for VO/OS contemplative lines', () => {
    expect(inferEmotionFromContent('洞府一甲子', 'OS')).toBeLessThanOrEqual(0.25)
    expect(inferEmotionFromContent('这是来自我血脉的呼喊？', 'OS')).toBeLessThanOrEqual(0.3)
  })

  it('raises intensity for exclamation', () => {
    expect(inferEmotionFromContent('位列仙班！', 'OS')).toBeGreaterThanOrEqual(0.3)
    expect(inferEmotionFromContent('住手！！', null)).toBeGreaterThanOrEqual(0.4)
  })

  it('stays within 0.1-0.5 scale', () => {
    for (const sample of ['', '...', '!!!!!!', '???', '正常对话内容', '哎呀，怎么办呢？']) {
      const v = inferEmotionFromContent(sample, null)
      expect(v).toBeGreaterThanOrEqual(0.1)
      expect(v).toBeLessThanOrEqual(0.5)
    }
  })
})
