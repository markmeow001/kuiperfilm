/**
 * 2026-05-30 — AtlasCloud composite prompt guardrails.
 *
 * Three guardrails surfaced by the multi-role 描述詞 review + peer-platform
 * research (workflow whueo4yke):
 *
 *  1. No-dialogue AUDIO DIRECTIVE must explicitly forbid synthesized
 *     vocals. Seedance, given a silent group whose description is packed
 *     with sound-source nouns (五要素 "環境音效" is mandatory), has been
 *     observed treating a sound noun like "低頻貝斯沉音" as a voice timbre
 *     and synthesizing a human-like hum (2026-05-29 incident). The old
 *     directive only said "請勿合成說話聲" — too weak.
 *
 *  2. rawPrompt scaffold (ref-map prepend + timing-guide append) must
 *     de-duplicate: if the user already hand-wrote "參考圖對應" or
 *     "鏡頭時長分配" in their textarea, we must NOT prepend/append a
 *     second copy (wastes tokens, confuses the model).
 *
 *  3. Prompt-length awareness: a pure estimator + threshold so the worker
 *     can WARN when an over-rich prompt risks tail-truncation (>2200-token
 *     band where Seedance starts dropping late-shot narrative).
 *
 * These are pure functions extracted from the worker so they can be
 * tested behaviorally (the worker entry has BullMQ/prisma/COS deps that
 * are infeasible to mock for a unit suite).
 */
import { describe, expect, it } from 'vitest'
import {
  buildAudioDirective,
  composeRawPromptScaffold,
  estimatePromptTokens,
  isPromptLengthRisky,
  PROMPT_TOKEN_WARN_THRESHOLD,
} from '@/lib/workers/handlers/multi-shot-video-atlascloud-path'

describe('buildAudioDirective', () => {
  it('with dialogue: keeps lip-sync TTS instruction', () => {
    const d = buildAudioDirective(2)
    expect(d).toMatch(/逐字配音|唇形/)
    expect(d).toMatch(/環境音/)
  })

  it('no dialogue: explicitly forbids any human / human-like synthesized voice', () => {
    const d = buildAudioDirective(0)
    // Must go beyond the old weak "請勿合成說話聲" — explicitly ban
    // vocals AND human-like timbres so a sound-source noun in the
    // description can't be mistaken for a voice to synthesize.
    expect(d).toMatch(/嚴禁|禁止/)
    expect(d).toMatch(/人聲/)
    expect(d).toMatch(/類人聲|哼唱|歌聲|說話聲/)
    // Still asks for natural ambient.
    expect(d).toMatch(/環境音|自然音/)
  })
})

describe('composeRawPromptScaffold', () => {
  const refMap = '參考圖對應：\nimage 1 = 角色「Vera」'
  const timing = '鏡頭時長分配（請嚴格按此節奏）：第1鏡約3秒、第2鏡約4秒，全片約7秒。'

  it('prepends ref-map and appends timing when the user wrote neither', () => {
    const out = composeRawPromptScaffold('黑貓落地幻化成 @Vera', refMap, timing)
    expect(out.indexOf('參考圖對應')).toBeLessThan(out.indexOf('黑貓落地'))
    expect(out.indexOf('黑貓落地')).toBeLessThan(out.indexOf('鏡頭時長分配'))
  })

  it('does NOT duplicate ref-map when the user already wrote 參考圖對應', () => {
    const raw = '參考圖對應：image 1 = 角色「Vera」\n黑貓落地幻化成 @Vera'
    const out = composeRawPromptScaffold(raw, refMap, timing)
    expect(out.match(/參考圖對應/g)).toHaveLength(1)
  })

  it('does NOT duplicate timing guide when the user already wrote 鏡頭時長分配', () => {
    const raw = '黑貓落地幻化成 @Vera\n鏡頭時長分配：第1鏡約5秒'
    const out = composeRawPromptScaffold(raw, refMap, timing)
    expect(out.match(/鏡頭時長分配/g)).toHaveLength(1)
  })

  it('ships verbatim when refMap and timing are both empty', () => {
    expect(composeRawPromptScaffold('純文字', '', '')).toBe('純文字')
  })
})

describe('estimatePromptTokens / isPromptLengthRisky', () => {
  it('estimates CJK-heavy text at roughly one token per character', () => {
    const t = estimatePromptTokens('一二三四五六七八九十')
    expect(t).toBeGreaterThanOrEqual(8)
    expect(t).toBeLessThanOrEqual(14)
  })

  it('flags prompts beyond the warn threshold as risky', () => {
    const long = '鏡'.repeat(PROMPT_TOKEN_WARN_THRESHOLD + 200)
    expect(isPromptLengthRisky(long)).toBe(true)
  })

  it('does not flag a normal-length prompt', () => {
    expect(isPromptLengthRisky('第1鏡：中景，@Vera 走向 @William。環境音效：低頻風聲。')).toBe(false)
  })
})
