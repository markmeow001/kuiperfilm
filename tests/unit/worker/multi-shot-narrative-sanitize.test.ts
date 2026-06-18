import { describe, expect, it } from 'vitest'
import { stripCaptionLines } from '@/lib/workers/handlers/multi-shot-narrative-sanitize'

// 2026-06-17 — the storyboard LLM introduces characters via on-screen caption
// lines (乾 字幕: 王玄二弟子) which get both rendered into the frame AND read aloud
// as 口白. stripCaptionLines drops them before the prompt is sent (root cause is
// the prompt fix; this is the safety net for already-saved narratives).
describe('stripCaptionLines', () => {
  it('removes 字幕 / 字卡 name-card lines (the reported bug case)', () => {
    const narrative = [
      '镜头1: 中景·缓慢上摇',
      '[开头] 开始 · @乾、@坤 呈错落站位齐齐面向高处。',
      '环境音效: 高处凛冽的风声呼啸。',
      '乾  字幕: 王玄二弟子，',
      '坤  字幕: 王玄三弟子，',
      '坎  字卡: 王玄四弟子，离',
      '镜头2: 中景·极缓推近',
    ].join('\n')
    const { cleaned, removed } = stripCaptionLines(narrative)
    expect(removed).toEqual([
      '乾  字幕: 王玄二弟子，',
      '坤  字幕: 王玄三弟子，',
      '坎  字卡: 王玄四弟子，离',
    ])
    expect(cleaned).not.toMatch(/字幕|字卡/)
    // legitimate lines survive
    expect(cleaned).toContain('环境音效: 高处凛冽的风声呼啸。')
    expect(cleaned).toContain('镜头1: 中景·缓慢上摇')
    expect(cleaned).toContain('镜头2: 中景·极缓推近')
  })

  it('keeps prose that mentions 字幕 without a labeling colon', () => {
    const narrative = '她盯着电视上滚动的字幕出神，手指无意识敲打桌面。'
    const { cleaned, removed } = stripCaptionLines(narrative)
    expect(removed).toEqual([])
    expect(cleaned).toBe(narrative)
  })

  it('no-ops a clean narrative (returns original reference semantics)', () => {
    const narrative = '镜头1: @王玄 立于崖边，狂风鼓动道袍。\n环境音效: 风声。'
    const { cleaned, removed } = stripCaptionLines(narrative)
    expect(removed).toEqual([])
    expect(cleaned).toBe(narrative)
  })

  it('handles empty / whitespace input', () => {
    expect(stripCaptionLines('')).toEqual({ cleaned: '', removed: [] })
  })

  it('collapses blank gaps left by removed caption lines', () => {
    const narrative = 'A\n\n乾 字幕: 二弟子\n\nB'
    const { cleaned } = stripCaptionLines(narrative)
    expect(cleaned).toBe('A\n\nB')
  })
})
