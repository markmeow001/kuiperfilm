import { ApiError } from '@/lib/api-errors'
import {
  resolveAtlasCloudSeedAudioConfiguration,
  type ModelSelection,
} from '@/lib/api-config'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import {
  ATLASCLOUD_PROVIDER_KEY,
  ATLASCLOUD_SEED_AUDIO_MODEL_ID,
  AtlasCloudSeedAudioConfigError,
} from '@/lib/voice/atlascloud-seed-audio-contract'

function providerFamily(provider: string): string {
  return provider.split(':', 1)[0]?.toLowerCase() || ''
}

export function assertSupportedAtlasCloudSeedAudioRequest(modelKey: string): void {
  if (!modelKey) return
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'audioModel',
    })
  }
  if (
    providerFamily(parsed.provider) !== ATLASCLOUD_PROVIDER_KEY
    || parsed.modelId !== ATLASCLOUD_SEED_AUDIO_MODEL_ID
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'AUDIO_MODEL_UNSUPPORTED',
      message: '新配音只支援 AtlasCloud Seed Audio 1.0，請移除舊模型選擇後重試',
      details: {
        supportedModelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      },
    })
  }
}

export async function requireAtlasCloudSeedAudioSelection(
  userId: string,
  requestedModelKey?: string,
): Promise<ModelSelection> {
  try {
    const configuration = await resolveAtlasCloudSeedAudioConfiguration(userId)
    const { selection } = configuration
    if (
      providerFamily(selection.provider) !== ATLASCLOUD_PROVIDER_KEY
      || selection.modelId !== ATLASCLOUD_SEED_AUDIO_MODEL_ID
    ) {
      throw new AtlasCloudSeedAudioConfigError(
        'ATLAS_AUDIO_CONFIG_INVALID',
        'AtlasCloud 配音設定未解析到 Seed Audio 1.0，請在 /profile 重新儲存模型設定',
      )
    }
    const requested = requestedModelKey?.trim()
    if (requested && requested !== selection.modelKey) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'AUDIO_MODEL_SELECTION_MISMATCH',
        field: 'audioModel',
        message: '指定的 AtlasCloud 配音 provider 與目前啟用設定不一致',
        details: {
          requestedModelKey: requested,
          configuredModelKey: selection.modelKey,
        },
      })
    }
    return selection
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof AtlasCloudSeedAudioConfigError) {
      throw new ApiError('MISSING_CONFIG', {
        code: error.code,
        message: error.message,
        setupPath: '/profile',
        provider: ATLASCLOUD_PROVIDER_KEY,
        modelId: ATLASCLOUD_SEED_AUDIO_MODEL_ID,
      })
    }
    throw error
  }
}
