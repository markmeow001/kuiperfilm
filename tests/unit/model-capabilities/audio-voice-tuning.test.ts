import { describe, expect, it } from 'vitest'
import { PRESET_MODELS } from '@/app/[locale]/profile/components/api-config/types'
import { validateModelCapabilities } from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'

const SEED_AUDIO_MODEL_ID = 'bytedance/seed-audio-1.0'

describe('Atlas Cloud Seed Audio 1.0 capabilities', () => {
  it('[audio preset catalog] -> [exposes only Atlas Cloud Seed Audio instead of FAL IndexTTS2]', () => {
    expect(PRESET_MODELS.filter((model) => model.type === 'audio')).toEqual([{
      modelId: SEED_AUDIO_MODEL_ID,
      name: 'Seed Audio 1.0 (AtlasCloud)',
      type: 'audio',
      provider: 'atlascloud',
    }])
  })

  it('[Seed Audio builtin metadata] -> [matches verified reference and tuning controls]', () => {
    expect(findBuiltinCapabilities('audio', 'atlascloud', SEED_AUDIO_MODEL_ID)?.audio).toEqual({
      supportReferenceAudio: true,
      supportEmotionPrompt: true,
      supportEmotionStrength: false,
      supportEmotionVector: false,
      supportSpeed: true,
      speedRange: {
        min: -50,
        max: 100,
        step: 1,
        defaultValue: 0,
      },
      supportPitch: true,
      pitchRange: {
        min: -12,
        max: 12,
        step: 1,
        defaultValue: 0,
      },
      supportVolume: true,
      volumeRange: {
        min: -50,
        max: 100,
        step: 1,
        defaultValue: 0,
      },
      supportPause: false,
    })
  })

  it('[Atlas Cloud provider instance] -> [inherits the exact canonical Seed Audio metadata]', () => {
    expect(findBuiltinCapabilities('audio', 'atlascloud:primary', SEED_AUDIO_MODEL_ID)?.audio).toEqual(
      findBuiltinCapabilities('audio', 'atlascloud', SEED_AUDIO_MODEL_ID)?.audio,
    )
  })

  it.each([
    'supportReferenceAudio',
    'supportEmotionPrompt',
    'supportEmotionStrength',
    'supportEmotionVector',
    'supportSpeed',
    'supportPitch',
    'supportVolume',
    'supportPause',
  ] as const)('[non-boolean %s] -> [capability validation fails closed]', (field) => {
    const issues = validateModelCapabilities('audio', {
      audio: {
        [field]: 'yes',
      },
    })

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_FIELD_INVALID',
      field: `capabilities.audio.${field}`,
    }))
  })

  it.each([
    ['non-object', 'fast', 'capabilities.audio.speedRange'],
    ['non-finite min', { min: Number.NaN, max: 100, step: 1, defaultValue: 0 }, 'capabilities.audio.speedRange.min'],
    ['reversed bounds', { min: 100, max: -50, step: 1, defaultValue: 0 }, 'capabilities.audio.speedRange'],
    ['zero step', { min: -50, max: 100, step: 0, defaultValue: 0 }, 'capabilities.audio.speedRange.step'],
    ['default below min', { min: -50, max: 100, step: 1, defaultValue: -51 }, 'capabilities.audio.speedRange.defaultValue'],
    ['unknown range field', { min: -50, max: 100, step: 1, defaultValue: 0, unit: '%' }, 'capabilities.audio.speedRange.unit'],
  ])('[invalid speed range: %s] -> [exact range field is rejected]', (_label, range, field) => {
    const issues = validateModelCapabilities('audio', {
      audio: {
        supportSpeed: true,
        speedRange: range,
      },
    })

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_FIELD_INVALID',
      field,
    }))
  })

  it.each([
    ['supportEmotionStrength', 'emotionStrengthRange'],
    ['supportSpeed', 'speedRange'],
    ['supportPitch', 'pitchRange'],
    ['supportVolume', 'volumeRange'],
  ] as const)('[%s without %s] -> [metadata is rejected instead of inventing limits]', (supportField, rangeField) => {
    const issues = validateModelCapabilities('audio', {
      audio: { [supportField]: true },
    })

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_FIELD_INVALID',
      field: `capabilities.audio.${rangeField}`,
    }))
  })

  it('[unknown audio tuning field] -> [metadata is rejected instead of leaking an unverified control]', () => {
    const issues = validateModelCapabilities('audio', {
      audio: { supportTempoWarp: true },
    })

    expect(issues).toContainEqual({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.audio.supportTempoWarp',
      message: 'Unknown capability field: supportTempoWarp',
    })
  })
})
