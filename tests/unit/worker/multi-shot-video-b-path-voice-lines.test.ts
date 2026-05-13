import { describe, expect, it } from 'vitest'
import {
  normalizeVoiceLinesToDialogue,
  extractSpokenLineFromSrtSegment,
  looksLikeStageDirection,
} from '@/lib/workers/handlers/multi-shot-video-b-path'

/**
 * Regression suite for 2026-05-13 bug:
 *
 *   "劇本寫 15 秒, 影片只有 10 秒, 對白也說錯了" — voice lines extracted
 *   by the 4-prompt LLM pipeline are pure spoken text (no quote / no
 *   speaker-prefix). The worker passed them through
 *   extractSpokenLineFromSrtSegment, which is designed for mixed
 *   narration+dialogue srtSegment payloads and returns null for clean
 *   spoken text. Result: dialogueByPanel was empty, dialogue-driven
 *   duration allocator never engaged, worker fell through to Kling
 *   intelligence mode (~10s default), and audio dubbing was decoupled
 *   from per-panel lines.
 */

describe('normalizeVoiceLinesToDialogue (2026-05-13 bug regression)', () => {
  it('passes through clean spoken text from the 4-prompt LLM pipeline', () => {
    const out = normalizeVoiceLinesToDialogue(
      [
        {
          speaker: '王玄',
          content:
            '当年我误入结界百年，没想到世俗才过去五年，按世俗年龄我应该是三十六岁，当年我辜负了刚有孕在身的未婚妻紫凝',
        },
      ],
      '旁白',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      speaker: '王玄',
      content:
        '当年我误入结界百年，没想到世俗才过去五年，按世俗年龄我应该是三十六岁，当年我辜负了刚有孕在身的未婚妻紫凝',
    })
  })

  it('falls back to fallbackSpeaker when voice line has no speaker', () => {
    const out = normalizeVoiceLinesToDialogue(
      [{ speaker: '', content: '我会回来的' }],
      '主角',
    )
    expect(out).toEqual([{ speaker: '主角', content: '我会回来的' }])
  })

  it('still handles legacy quoted srtSegment-style content (mixed narration + dialogue)', () => {
    const out = normalizeVoiceLinesToDialogue(
      [
        {
          speaker: 'SARAH',
          content: 'SARAH嘴巴张大，震惊不已。 SARAH: "Dios mío... ¿Catherine?"',
        },
      ],
      '旁白',
    )
    expect(out).toHaveLength(1)
    expect(out[0].speaker).toBe('SARAH')
    expect(out[0].content).toContain('Dios mío')
  })

  it('drops pure stage directions entirely (silent panel signal)', () => {
    const out = normalizeVoiceLinesToDialogue(
      [
        {
          speaker: '旁白',
          content: '慢动作中景:CATHERINE单脚蹬墙，画面定格',
        },
      ],
      '旁白',
    )
    expect(out).toEqual([])
  })

  it('drops empty content lines silently', () => {
    const out = normalizeVoiceLinesToDialogue(
      [
        { speaker: '王玄', content: '   ' },
        { speaker: '紫凝', content: '' },
      ],
      '旁白',
    )
    expect(out).toEqual([])
  })

  it('preserves a mix of clean and quoted lines in the same panel', () => {
    const out = normalizeVoiceLinesToDialogue(
      [
        { speaker: '王玄', content: '当年我误入结界百年' },
        { speaker: '紫凝', content: '紫凝说："你终于回来了"' },
      ],
      '旁白',
    )
    expect(out).toHaveLength(2)
    expect(out[0].content).toBe('当年我误入结界百年')
    expect(out[1].content).toContain('你终于回来了')
  })
})

describe('extractSpokenLineFromSrtSegment + looksLikeStageDirection (helpers)', () => {
  it('extractor returns null for pure spoken text without markers (the bug condition)', () => {
    // This documents the existing behavior — pure spoken text has no
    // anchors for the extractor's regexes. The fix lives in
    // normalizeVoiceLinesToDialogue which falls back to raw content
    // when the extractor returns null AND the content is not a stage
    // direction.
    expect(
      extractSpokenLineFromSrtSegment('当年我误入结界百年', '王玄'),
    ).toBeNull()
  })

  it('stage-direction detector recognizes camera framing keywords', () => {
    expect(looksLikeStageDirection('慢动作中景:CATHERINE单脚蹬墙')).toBe(true)
    expect(looksLikeStageDirection('近景：王玄眼睑微垂')).toBe(true)
    expect(looksLikeStageDirection('画外音：他说道')).toBe(true)
  })

  it('stage-direction detector does NOT flag pure dialogue lines', () => {
    expect(looksLikeStageDirection('当年我误入结界百年')).toBe(false)
    expect(looksLikeStageDirection('你终于回来了')).toBe(false)
    expect(looksLikeStageDirection('Gracias por el dinero.')).toBe(false)
  })
})
