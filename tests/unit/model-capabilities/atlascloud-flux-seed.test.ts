import { describe, expect, it } from 'vitest'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'

describe('AtlasCloud FLUX.2 seed capability', () => {
  it('FLUX.2 Pro/Flex/Dev 官方端點支援 seed -> 內建能力表一律開啟 seed', () => {
    for (const modelId of ['flux-2-pro', 'flux-2-flex', 'flux-2-dev']) {
      expect(findBuiltinCapabilities('image', 'atlascloud', modelId)?.image?.supportSeed).toBe(true)
    }
  })
})
