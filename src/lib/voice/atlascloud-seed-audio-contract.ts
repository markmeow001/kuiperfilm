export const ATLASCLOUD_PROVIDER_KEY = 'atlascloud'
export const ATLASCLOUD_SEED_AUDIO_MODEL_ID = 'bytedance/seed-audio-1.0'

export type AtlasCloudSeedAudioConfigErrorCode =
  | 'ATLAS_AUDIO_MODEL_NOT_CONFIGURED'
  | 'ATLAS_AUDIO_PROVIDER_AMBIGUOUS'
  | 'ATLAS_AUDIO_PROVIDER_NOT_CONFIGURED'
  | 'ATLAS_AUDIO_API_KEY_MISSING'
  | 'ATLAS_AUDIO_CONFIG_INVALID'

export class AtlasCloudSeedAudioConfigError extends Error {
  readonly code: AtlasCloudSeedAudioConfigErrorCode

  constructor(
    code: AtlasCloudSeedAudioConfigErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'AtlasCloudSeedAudioConfigError'
    this.code = code
  }
}

