import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookupMock = vi.hoisted(() => ({
  resolveBuiltinPricing: vi.fn(),
}))

vi.mock('@/lib/model-pricing/lookup', () => ({
  resolveBuiltinPricing: lookupMock.resolveBuiltinPricing,
}))

import { calcImage, calcText, calcVideo, calcVoice } from '@/lib/billing/cost'

describe('billing/cost error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws ambiguous pricing error when catalog has multiple candidates', () => {
    lookupMock.resolveBuiltinPricing.mockReturnValue({
      status: 'ambiguous_model',
      apiType: 'image',
      modelId: 'shared-model',
      candidates: [
        {
          apiType: 'image',
          provider: 'p1',
          modelId: 'shared-model',
          pricing: { mode: 'flat', flatAmount: 1 },
        },
        {
          apiType: 'image',
          provider: 'p2',
          modelId: 'shared-model',
          pricing: { mode: 'flat', flatAmount: 1 },
        },
      ],
    })

    expect(() => calcImage('shared-model', 1)).toThrow('Ambiguous image pricing modelId')
  })

  it('throws unknown model when catalog returns not_configured', () => {
    lookupMock.resolveBuiltinPricing.mockReturnValue({
      status: 'not_configured',
    })

    expect(() => calcImage('provider::missing-image-model', 1)).toThrow('Unknown image model pricing')
  })

  it('legacy media NaN normalizes to zero while voice character NaN fails explicitly', () => {
    lookupMock.resolveBuiltinPricing.mockImplementation(
      (input: { apiType?: string; selections?: { tokenType?: 'input' | 'output' } }) => {
        if (input.selections?.tokenType === 'input') return { status: 'resolved', amount: 2 }
        if (input.selections?.tokenType === 'output') return { status: 'resolved', amount: 4 }
        if (input.apiType === 'voice') {
          return {
            status: 'resolved',
            amount: 3,
            entry: {
              apiType: 'voice',
              provider: 'atlascloud',
              modelId: 'voice-model',
              pricing: { mode: 'usage', currency: 'USD', unit: 'character', unitAmount: 3, countScale: 1_000 },
            },
          }
        }
        return { status: 'resolved', amount: 3 }
      },
    )

    expect(calcText('text-model', Number.NaN, 1_000_000)).toBeCloseTo(4, 8)
    expect(calcText('text-model', 1_000_000, Number.NaN)).toBeCloseTo(2, 8)
    expect(calcImage('image-model', Number.NaN)).toBe(0)
    expect(calcVideo('video-model', '720p', Number.NaN)).toBe(0)
    expect(() => calcVoice('voice-model', Number.NaN)).toThrow('Voice character count must be a non-negative integer')
  })
})
