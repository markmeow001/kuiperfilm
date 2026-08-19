import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import {
  classifyPaidVoiceProviderHandoff,
  isProtectedVoiceLineProviderHandoff,
  isSafelyTerminalPaidVoiceProviderFailure,
  paidVoiceProviderTerminalErrorCode,
} from '@/lib/task/voice-line-recovery-policy'

describe('paid voice provider handoff protection policy', () => {
  it.each([
    'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1',
    'ATLASCLOUD:AUDIO:CLAIM:123:owner',
    'malformed-nonempty-handoff',
    'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-legacy',
  ])('[Canvas TTS has nonempty handoff %s] -> [protects it for recovery or quarantine]', (externalId) => {
    expect(isProtectedVoiceLineProviderHandoff({
      type: TASK_TYPE.CANVAS_TTS,
      externalId,
    })).toBe(true)
  })

  it.each([null, '', '   '])('[Canvas TTS handoff is %s] -> [ordinary lifecycle remains eligible]', (externalId) => {
    expect(isProtectedVoiceLineProviderHandoff({
      type: TASK_TYPE.CANVAS_TTS,
      externalId,
    })).toBe(false)
  })

  it('[unrelated task has a nonempty external id] -> [voice recovery policy does not capture it]', () => {
    expect(isProtectedVoiceLineProviderHandoff({
      type: TASK_TYPE.VIDEO_PANEL,
      externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1',
    })).toBe(false)
  })

  it.each([
    {
      externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-1',
      provider: 'atlascloud',
    },
  ])('[actual $provider handoff] -> [classifies an exact resumable provider id]', ({ externalId, provider }) => {
    expect(classifyPaidVoiceProviderHandoff({
      type: TASK_TYPE.VOICE_LINE,
      externalId,
    })).toEqual({ kind: 'actual', provider, externalId })
  })

  it.each([
    ['ATLASCLOUD:AUDIO:CLAIM:123:owner', 'claim'],
    ['ATLASCLOUD:AUDIO:missing-request-id:', 'malformed'],
    ['malformed-nonempty-handoff', 'malformed'],
    // Voice is AtlasCloud-only. A retired provider's ids are unrecognised
    // rather than resumable, and must stay quarantined, never refunded.
    ['FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-legacy', 'malformed'],
    ['FAL:VOICE:CLAIM:123:owner', 'malformed'],
  ] as const)('[handoff %s] -> [classifies as %s and never as an actual provider id]', (externalId, kind) => {
    expect(classifyPaidVoiceProviderHandoff({
      type: TASK_TYPE.CANVAS_TTS,
      externalId,
    })).toEqual({ kind, externalId })
  })

  it.each(['failed', 'timeout'] as const)('[provider terminal %s marker on exact id] -> [allows a new logical VoiceLine attempt]', (terminalStatus) => {
    const externalId = 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-terminal'
    expect(isSafelyTerminalPaidVoiceProviderFailure({
      type: TASK_TYPE.VOICE_LINE,
      status: 'failed',
      externalId,
      errorCode: paidVoiceProviderTerminalErrorCode(terminalStatus),
    })).toBe(true)
  })

  it.each([
    { externalId: 'ATLASCLOUD:AUDIO:CLAIM:123:owner', errorCode: paidVoiceProviderTerminalErrorCode('failed') },
    { externalId: 'malformed', errorCode: paidVoiceProviderTerminalErrorCode('timeout') },
    { externalId: 'ATLASCLOUD:AUDIO:bytedance/seed-audio-1.0:prediction-ambiguous', errorCode: 'EXTERNAL_ERROR' },
  ])('[claim, malformed, or ambiguous failure $externalId] -> [does not release provider-handoff protection]', ({ externalId, errorCode }) => {
    expect(isSafelyTerminalPaidVoiceProviderFailure({
      type: TASK_TYPE.VOICE_LINE,
      status: 'failed',
      externalId,
      errorCode,
    })).toBe(false)
  })
})
