import { describe, expect, it } from 'vitest'
import {
  resolveCharacterVoiceWrite,
  VoiceSourceWritePolicyError,
} from '@/lib/voice/character-voice-write-policy'

describe('character durable voice source write policy', () => {
  it('[未包含 voice 欄位] -> [保留非 voice character 修改]', () => {
    expect(resolveCharacterVoiceWrite({ introduction: 'updated' })).toEqual({ kind: 'none' })
  })

  it('[三個 voice 欄位皆明確為 null] -> [允許清除 legacy source]', () => {
    expect(resolveCharacterVoiceWrite({
      voiceId: null,
      voiceType: null,
      customVoiceUrl: null,
    })).toEqual({
      kind: 'clear',
      data: {
        voiceId: null,
        voiceType: null,
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    })
  })

  it.each([
    { label: 'partial clear', value: { voiceId: null } },
    { label: 'provider id', value: { voiceId: 'custom-provider-id', voiceType: null, customVoiceUrl: null } },
    { label: 'raw http', value: { voiceId: null, voiceType: 'custom', customVoiceUrl: 'https://attacker.example/voice.wav' } },
    { label: 'data URL', value: { voiceId: null, voiceType: 'custom', customVoiceUrl: 'data:audio/wav;base64,ZmFrZQ==' } },
    { label: 'foreign media route', value: { voiceId: null, voiceType: 'custom', customVoiceUrl: '/m/foreign-media' } },
    { label: 'durable media relation', value: { voiceId: null, voiceType: null, customVoiceUrl: null, customVoiceMediaId: 'media-foreign' } },
  ])('[新增或不完整 source：$label] -> [consent schema 前 fail-closed]', ({ value }) => {
    expect(() => resolveCharacterVoiceWrite(value)).toThrowError(
      expect.objectContaining({
        code: 'VOICE_SOURCE_CONSENT_REQUIRED',
      }) as VoiceSourceWritePolicyError,
    )
  })
})
