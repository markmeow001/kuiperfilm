import { describe, expect, it } from 'vitest'
import {
  detectEra,
  pickStyleReference,
  resolvePresetKeyByPositivePrompt,
} from '@/lib/style-profile/style-reference-picker'
import { STYLE_PROFILE_PRESETS, type StyleReferenceImage } from '@/lib/style-profile/presets'

describe('detectEra', () => {
  it('returns neutral for empty / whitespace input', () => {
    expect(detectEra('')).toBe('neutral')
    expect(detectEra('   ')).toBe('neutral')
  })

  it('detects period from xianxia / palace keywords', () => {
    expect(detectEra('王玄走入洞府，弟子们躬身行礼')).toBe('period')
    expect(detectEra('皇上驾到，众卿跪安')).toBe('period')
    expect(detectEra('修真大典之上，门派长老依次入席')).toBe('period')
  })

  it('detects modern from contemporary keywords', () => {
    expect(detectEra('她拿出手機，撥了一通電話')).toBe('modern')
    expect(detectEra('辦公室裡，王總翻看著筆電')).toBe('modern')
    expect(detectEra('穿著西裝走進咖啡廳')).toBe('modern')
  })

  it('returns modern when both period and modern keywords appear (mixed-era POV)', () => {
    // TikTok short with modern protagonist seeing period flashback —
    // worker prefers the modern anchor since the framing scene is
    // contemporary.
    const text = '王玄拿出手機，看著手機裡洞府中弟子們修真的記憶'
    expect(detectEra(text)).toBe('modern')
  })

  it('returns neutral when no era keywords appear', () => {
    expect(detectEra('天空很藍，風很大，他抬頭望著遠方')).toBe('neutral')
  })

  it('is case-insensitive for ASCII keywords', () => {
    expect(detectEra('WIFI 信號滿格')).toBe('modern')
    expect(detectEra('app 通知響了')).toBe('modern')
  })
})

describe('pickStyleReference', () => {
  const PERIOD: StyleReferenceImage = { url: 'https://x/period.jpg', eraHint: 'period', label: 'p' }
  const MODERN: StyleReferenceImage = { url: 'https://x/modern.jpg', eraHint: 'modern', label: 'm' }
  const NEUTRAL: StyleReferenceImage = { url: 'https://x/neutral.jpg', eraHint: 'neutral', label: 'n' }

  it('returns null when pool is undefined or empty', () => {
    expect(pickStyleReference(undefined, 'period')).toBeNull()
    expect(pickStyleReference([], 'period')).toBeNull()
  })

  it('returns null when every entry has empty url', () => {
    expect(
      pickStyleReference(
        [{ url: '', eraHint: 'period', label: 'p' }, { url: '   ', eraHint: 'neutral', label: 'n' }],
        'period',
      ),
    ).toBeNull()
  })

  it('prefers exact era match', () => {
    expect(pickStyleReference([PERIOD, MODERN, NEUTRAL], 'period')).toBe(PERIOD)
    expect(pickStyleReference([PERIOD, MODERN, NEUTRAL], 'modern')).toBe(MODERN)
    expect(pickStyleReference([PERIOD, MODERN, NEUTRAL], 'neutral')).toBe(NEUTRAL)
  })

  it('falls back to neutral when exact era missing', () => {
    expect(pickStyleReference([MODERN, NEUTRAL], 'period')).toBe(NEUTRAL)
  })

  it('falls back to first entry when neither exact nor neutral exists', () => {
    expect(pickStyleReference([PERIOD], 'modern')).toBe(PERIOD)
  })

  it('filters out empty-url entries before considering them', () => {
    const blankPeriod: StyleReferenceImage = { url: '', eraHint: 'period', label: 'blank' }
    expect(pickStyleReference([blankPeriod, MODERN, NEUTRAL], 'period')).toBe(NEUTRAL)
  })
})

describe('resolvePresetKeyByPositivePrompt', () => {
  it('returns null for null / empty input', () => {
    expect(resolvePresetKeyByPositivePrompt(null)).toBeNull()
    expect(resolvePresetKeyByPositivePrompt('')).toBeNull()
  })

  it('resolves the realistic preset by exact positivePrompt match', () => {
    const realistic = STYLE_PROFILE_PRESETS.realistic
    expect(resolvePresetKeyByPositivePrompt(realistic.positivePrompt)).toBe('realistic')
  })

  it('returns null when the positivePrompt does not match any preset', () => {
    expect(
      resolvePresetKeyByPositivePrompt('totally custom user-written prompt that no preset uses'),
    ).toBeNull()
  })
})
