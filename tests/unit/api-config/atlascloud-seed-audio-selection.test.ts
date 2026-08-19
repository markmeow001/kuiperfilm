import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/crypto-utils', () => ({
  encryptApiKey: (value: string) => value,
  decryptApiKey: (value: string) => `decrypted:${value}`,
}))

type StoredModel = {
  modelId: string
  modelKey: string
  name: string
  type: 'audio' | 'llm'
  provider: string
  price: number
}

type StoredProvider = {
  id: string
  name: string
  apiKey?: string
}

const ADMIN_ID = 'admin-atlas'
const MEMBER_ID = 'member-atlas'
const SEED_AUDIO_MODEL_ID = 'bytedance/seed-audio-1.0'

function preference(models: StoredModel[], providers: StoredProvider[] = []) {
  return {
    customModels: JSON.stringify(models),
    customProviders: JSON.stringify(providers),
  }
}

function audioModel(provider: string, modelId = SEED_AUDIO_MODEL_ID): StoredModel {
  return {
    modelId,
    modelKey: `${provider}::${modelId}`,
    name: modelId,
    type: 'audio',
    provider,
    price: 0,
  }
}

async function loadApiConfig() {
  return await import('@/lib/api-config')
}

describe('AtlasCloud Seed Audio configuration selection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('[legacy FAL and Atlas audio are both enabled] -> [selects the canonical Atlas model without UI selection]', async () => {
    const adminPreference = preference(
      [
        audioModel('fal', 'fal-ai/index-tts-2/text-to-speech'),
        audioModel('atlascloud'),
      ],
      [
        { id: 'fal', name: 'FAL', apiKey: 'fal-secret' },
        { id: 'atlascloud', name: 'AtlasCloud', apiKey: 'atlas-secret' },
      ],
    )
    prismaMock.userPreference.findUnique.mockResolvedValue(adminPreference)

    const { resolveAtlasCloudSeedAudioConfiguration } = await loadApiConfig()
    const result = await resolveAtlasCloudSeedAudioConfiguration(ADMIN_ID)

    expect(result.selection).toEqual({
      provider: 'atlascloud',
      modelId: SEED_AUDIO_MODEL_ID,
      modelKey: `atlascloud::${SEED_AUDIO_MODEL_ID}`,
      mediaType: 'audio',
    })
    expect(result.provider).toEqual({
      id: 'atlascloud',
      name: 'AtlasCloud',
      apiKey: 'decrypted:atlas-secret',
      baseUrl: undefined,
      apiMode: undefined,
    })
  })

  it('[member has an unrelated own catalog] -> [inherits the admin composite Atlas provider and model]', async () => {
    const memberPreference = preference([
      audioModel('fal', 'fal-ai/index-tts-2/text-to-speech'),
      {
        modelId: 'member-analysis',
        modelKey: 'openrouter::member-analysis',
        name: 'Member analysis',
        type: 'llm',
        provider: 'openrouter',
        price: 0,
      },
    ])
    const adminPreference = preference(
      [audioModel('atlascloud:primary')],
      [{ id: 'atlascloud:primary', name: 'AtlasCloud Primary', apiKey: 'admin-atlas-secret' }],
    )
    prismaMock.userPreference.findUnique
      .mockResolvedValueOnce(memberPreference)
      .mockResolvedValueOnce(adminPreference)
      .mockResolvedValueOnce(memberPreference)
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: ADMIN_ID })

    const { resolveAtlasCloudSeedAudioConfiguration } = await loadApiConfig()
    const result = await resolveAtlasCloudSeedAudioConfiguration(MEMBER_ID)

    expect(result.selection).toEqual({
      provider: 'atlascloud:primary',
      modelId: SEED_AUDIO_MODEL_ID,
      modelKey: `atlascloud:primary::${SEED_AUDIO_MODEL_ID}`,
      mediaType: 'audio',
    })
    expect(result.provider.apiKey).toBe('decrypted:admin-atlas-secret')
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: 'admin' },
    }))
  })

  it('[base and composite Atlas entries are both enabled] -> [fails explicitly instead of switching credentials]', async () => {
    const adminPreference = preference(
      [audioModel('atlascloud:secondary'), audioModel('atlascloud')],
      [
        { id: 'atlascloud:secondary', name: 'AtlasCloud Secondary', apiKey: 'secondary-secret' },
        { id: 'atlascloud', name: 'AtlasCloud', apiKey: 'base-secret' },
      ],
    )
    prismaMock.userPreference.findUnique.mockResolvedValue(adminPreference)

    const { resolveAtlasCloudSeedAudioConfiguration } = await loadApiConfig()
    await expect(resolveAtlasCloudSeedAudioConfiguration(ADMIN_ID)).rejects.toMatchObject({
      name: 'AtlasCloudSeedAudioConfigError',
      code: 'ATLAS_AUDIO_PROVIDER_AMBIGUOUS',
    })
  })

  it('[two composite Atlas Seed Audio entries are enabled] -> [fails explicitly instead of guessing a provider]', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue(preference([
      audioModel('atlascloud:primary'),
      audioModel('atlascloud:secondary'),
    ]))

    const { resolveAtlasCloudSeedAudioConfiguration } = await loadApiConfig()

    await expect(resolveAtlasCloudSeedAudioConfiguration(ADMIN_ID)).rejects.toMatchObject({
      name: 'AtlasCloudSeedAudioConfigError',
      code: 'ATLAS_AUDIO_PROVIDER_AMBIGUOUS',
    })
  })

  it('[canonical Atlas audio model is missing] -> [fails with an actionable configuration code]', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue(preference([
      audioModel('fal', 'fal-ai/index-tts-2/text-to-speech'),
    ]))
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: ADMIN_ID })

    const { resolveAtlasCloudSeedAudioConfiguration } = await loadApiConfig()

    await expect(resolveAtlasCloudSeedAudioConfiguration(ADMIN_ID)).rejects.toMatchObject({
      name: 'AtlasCloudSeedAudioConfigError',
      code: 'ATLAS_AUDIO_MODEL_NOT_CONFIGURED',
    })
  })

  it('[Atlas model exists but its API key is missing] -> [fails before a generation task can be submitted]', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue(preference(
      [audioModel('atlascloud')],
      [{ id: 'atlascloud', name: 'AtlasCloud' }],
    ))

    const { resolveAtlasCloudSeedAudioConfiguration } = await loadApiConfig()

    await expect(resolveAtlasCloudSeedAudioConfiguration(ADMIN_ID)).rejects.toMatchObject({
      name: 'AtlasCloudSeedAudioConfigError',
      code: 'ATLAS_AUDIO_API_KEY_MISSING',
    })
  })
})
