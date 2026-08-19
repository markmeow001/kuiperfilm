import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({ default: fsMock }))

import {
  listBuiltinPricingCatalog,
  resetBuiltinPricingCatalogCacheForTest,
} from '@/lib/model-pricing/catalog'

const VALID_ENTRY = {
  apiType: 'voice',
  provider: 'atlascloud',
  modelId: 'bytedance/seed-audio-1.0',
  pricing: {
    mode: 'usage',
    currency: 'USD',
    unit: 'character',
    unitAmount: 0.015,
    countScale: 1_000,
  },
} as const

function setCatalogEntry(entry: unknown) {
  fsMock.readFileSync.mockReturnValue(JSON.stringify([entry]))
  resetBuiltinPricingCatalogCacheForTest()
}

describe('model-pricing usage catalog validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.readdirSync.mockReturnValue([{
      name: 'voice.pricing.json',
      isFile: () => true,
    }])
  })

  it('valid character usage pricing -> preserves the exact vendor rate and scale', () => {
    setCatalogEntry(VALID_ENTRY)

    expect(listBuiltinPricingCatalog()).toEqual([VALID_ENTRY])
  })

  it.each([
    ['missing usage currency', { ...VALID_ENTRY.pricing, currency: undefined }],
    ['unsupported usage currency', { ...VALID_ENTRY.pricing, currency: 'CNY' }],
    ['wrong usage unit', { ...VALID_ENTRY.pricing, unit: 'second' }],
    ['negative unit amount', { ...VALID_ENTRY.pricing, unitAmount: -0.015 }],
    ['zero count scale', { ...VALID_ENTRY.pricing, countScale: 0 }],
    ['fractional count scale', { ...VALID_ENTRY.pricing, countScale: 1.5 }],
    ['incompatible flat field', { ...VALID_ENTRY.pricing, flatAmount: 0.015 }],
    ['unknown usage field', { ...VALID_ENTRY.pricing, multiplier: 1 }],
  ])('%s -> rejects the catalog instead of guessing billing semantics', (_label, pricing) => {
    setCatalogEntry({ ...VALID_ENTRY, pricing })

    expect(() => listBuiltinPricingCatalog()).toThrow('PRICING_CATALOG_INVALID')
  })

  it('usage mode on a non-voice API -> rejects the catalog', () => {
    setCatalogEntry({ ...VALID_ENTRY, apiType: 'image' })

    expect(() => listBuiltinPricingCatalog()).toThrow('usage mode is only valid for voice')
  })
})
