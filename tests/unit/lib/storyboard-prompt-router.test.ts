import { describe, expect, it } from 'vitest'
import {
  isKlingVideoModel,
  pickStoryboardDetailPromptId,
} from '@/lib/novel-promotion/storyboard-prompt-router'
import { PROMPT_IDS } from '@/lib/prompt-i18n/prompt-ids'

describe('pickStoryboardDetailPromptId', () => {
  describe('returns Kling prompt for Kling-* models', () => {
    it.each([
      'Kling-3.0',
      'Kling-3.0-Omni',
      'Kling-2.6',
      'Kling-2.1',
      'Kling-O1',
      'Kling-1.6',
    ])('matches bare modelId %s', (modelId) => {
      expect(pickStoryboardDetailPromptId(modelId)).toBe(
        PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL,
      )
    })

    it('matches composite key with provider prefix', () => {
      expect(
        pickStoryboardDetailPromptId('tencent-vod::Kling-3.0-Omni'),
      ).toBe(PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL)
    })

    it('matches case-insensitively (defensive)', () => {
      expect(pickStoryboardDetailPromptId('kling-3.0')).toBe(
        PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL,
      )
      expect(pickStoryboardDetailPromptId('KLING-3.0')).toBe(
        PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL,
      )
    })
  })

  describe('returns generic prompt for non-Kling models', () => {
    it.each([
      'Vidu-q3',
      'Hailuo-02',
      'PixVerse-v6',
      'GV-3.1',
      'OS-2.0',
      'Seedance-1.5-pro',
      'Jimeng-3.0pro',
      'tencent-vod::Vidu-q3-mix',
      'fal::fal-ai/wan/v2.6',
    ])('routes %s to generic', (model) => {
      expect(pickStoryboardDetailPromptId(model)).toBe(
        PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL,
      )
    })
  })

  describe('defaults to generic on missing/empty input', () => {
    it.each([null, undefined, '', '   '])(
      'maps %p to generic prompt',
      (input) => {
        expect(pickStoryboardDetailPromptId(input)).toBe(
          PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL,
        )
      },
    )
  })

  it('does NOT match models that merely contain "kling" elsewhere', () => {
    // Defensive: only the prefix "Kling-" should trigger; substrings shouldn't.
    expect(pickStoryboardDetailPromptId('SomethingKling-3.0')).toBe(
      PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL,
    )
    expect(pickStoryboardDetailPromptId('kling3')).toBe(
      PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL,
    )
  })
})

describe('isKlingVideoModel', () => {
  it('returns true for Kling models', () => {
    expect(isKlingVideoModel('Kling-3.0')).toBe(true)
    expect(isKlingVideoModel('tencent-vod::Kling-2.6')).toBe(true)
  })

  it('returns false for non-Kling and empty inputs', () => {
    expect(isKlingVideoModel('Vidu-q3')).toBe(false)
    expect(isKlingVideoModel(null)).toBe(false)
    expect(isKlingVideoModel(undefined)).toBe(false)
    expect(isKlingVideoModel('')).toBe(false)
  })
})
