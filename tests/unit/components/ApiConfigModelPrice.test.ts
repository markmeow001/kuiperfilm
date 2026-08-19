import { describe, expect, it } from 'vitest'
import { getModelPriceTexts } from '@/app/[locale]/profile/components/api-config/provider-card/ModelRow'
import type { CustomModel } from '@/app/[locale]/profile/components/api-config/types'

describe('API config model pricing presentation', () => {
  it('preserves the Atlas USD usage label without adding the legacy yuan prefix', () => {
    const model: CustomModel = {
      modelId: 'bytedance/seed-audio-1.0',
      modelKey: 'atlascloud::bytedance/seed-audio-1.0',
      name: 'Seed Audio 1.0 (AtlasCloud)',
      type: 'audio',
      provider: 'atlascloud',
      enabled: true,
      price: 0.015,
      priceLabel: '$0.015 / 1K chars',
    }

    const translate = (key: string) => key
    expect(getModelPriceTexts(model, translate)).toEqual(['$0.015 / 1K chars'])
  })
})
