import { describe, expect, it } from 'vitest'
import {
  buildAtlasCloudSeedAudioText,
  countUnicodeCodePoints,
} from '@/lib/voice/atlascloud-seed-audio-input'

describe('Atlas Cloud Seed Audio input', () => {
  it('[reference voice + dialogue] -> [pins @audio1 and preserves exact trimmed dialogue]', () => {
    expect(buildAtlasCloudSeedAudioText({
      dialogue: '  你好，世界  ',
      emotionPrompt: null,
      emotionStrength: null,
    })).toBe('@audio1 你好，世界')
  })

  it('[emotion direction] -> [pins explicit prompt-driven direction without claiming native strength]', () => {
    expect(buildAtlasCloudSeedAudioText({
      dialogue: 'Hello there',
      emotionPrompt: ' restrained grief ',
      emotionStrength: 0.55,
    })).toBe('@audio1 [emotion: restrained grief; intensity: 0.55] Hello there')
  })

  it.each([
    ['', null, null],
    ['   ', null, null],
    ['Hello', 'calm', Number.NaN],
    ['Hello', 'calm', 0],
    ['Hello', 'calm', 1.1],
  ] as const)('[invalid dialogue/emotion tuple] -> [fails explicitly]', (
    dialogue,
    emotionPrompt,
    emotionStrength,
  ) => {
    expect(() => buildAtlasCloudSeedAudioText({
      dialogue,
      emotionPrompt,
      emotionStrength,
    })).toThrow('ATLAS_AUDIO_INPUT_INVALID')
  })

  it('[ASCII + CJK + astral emoji] -> [counts Unicode code points, not UTF-16 units]', () => {
    expect(countUnicodeCodePoints('A中😀')).toBe(3)
    expect('A中😀'.length).toBe(4)
  })
})
