import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// crypto-utils not exercised in these tests, but api-config imports it
vi.mock('@/lib/crypto-utils', () => ({
  encryptApiKey: (v: string) => v,
  decryptApiKey: (v: string) => v,
}))

import { getUserModels, getModelPrice } from '@/lib/api-config'

const ADMIN_ID = 'admin-id'
const MEMBER_ID = 'member-id'

const adminCustomModels = JSON.stringify([
  {
    modelId: 'google/gemini-3.1-pro-preview',
    modelKey: 'openrouter::google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    type: 'llm',
    provider: 'openrouter',
    price: 0,
  },
  {
    modelId: 'GEM-3.1',
    modelKey: 'tencent-vod::GEM-3.1',
    name: 'GEM-3.1',
    type: 'image',
    provider: 'tencent-vod',
    price: 0,
  },
])

describe('getUserModels — multi-user admin fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // module-level cache in api-config; advance system time so cache misses
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 0, 1)) // far future, fresh per test
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns member-own models when present (no fallback needed)', async () => {
    const memberModels = [
      {
        modelId: 'mine',
        modelKey: 'openrouter::mine',
        name: 'My Custom',
        type: 'llm',
        provider: 'openrouter',
        price: 1,
      },
    ]
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customModels: JSON.stringify(memberModels),
      customProviders: null,
    })

    const result = await getUserModels(MEMBER_ID)

    expect(result).toHaveLength(1)
    expect(result[0].modelId).toBe('mine')
    // admin lookup should be skipped
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it('falls back to admin models when member has none', async () => {
    prismaMock.userPreference.findUnique
      .mockResolvedValueOnce({ customModels: null, customProviders: null }) // member empty
      .mockResolvedValueOnce({ customModels: adminCustomModels, customProviders: null }) // admin
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: ADMIN_ID })

    const result = await getUserModels(MEMBER_ID)

    expect(result).toHaveLength(2)
    expect(result.map((m) => m.modelKey).sort()).toEqual([
      'openrouter::google/gemini-3.1-pro-preview',
      'tencent-vod::GEM-3.1',
    ])
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'admin' } }),
    )
  })

  it('does not loop when the requesting user IS the admin (returns own empty list)', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customModels: null,
      customProviders: null,
    })
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: ADMIN_ID })

    const result = await getUserModels(ADMIN_ID)

    expect(result).toEqual([])
    // Admin is the requester: readAdminConfig is consulted but its
    // userId === input userId, so we return the original (empty) list
    // instead of recursing.
  })

  it('getModelPrice uses the admin-fallback catalog', async () => {
    prismaMock.userPreference.findUnique
      .mockResolvedValueOnce({ customModels: null, customProviders: null }) // member
      .mockResolvedValueOnce({ customModels: adminCustomModels, customProviders: null }) // admin
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: ADMIN_ID })

    const price = await getModelPrice(MEMBER_ID, 'tencent-vod::GEM-3.1')

    expect(price).toBe(0)
  })

  it('getModelPrice still throws MODEL_NOT_FOUND when the model is in neither catalog', async () => {
    prismaMock.userPreference.findUnique
      .mockResolvedValueOnce({ customModels: null, customProviders: null })
      .mockResolvedValueOnce({ customModels: adminCustomModels, customProviders: null })
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: ADMIN_ID })

    await expect(getModelPrice(MEMBER_ID, 'fal::nonexistent')).rejects.toThrow(
      'MODEL_NOT_FOUND: fal::nonexistent',
    )
  })
})
