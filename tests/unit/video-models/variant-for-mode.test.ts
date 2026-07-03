import { describe, it, expect } from 'vitest'
import { variantKeyForMode, isVariantSuffixedKey } from '@/lib/video-models/variant-for-mode'

const SEEDANCE_KEYS = [
  'atlascloud::seedance-2.0-t2v',
  'atlascloud::seedance-2.0-i2v',
  'atlascloud::seedance-2.0-r2v',
  'atlascloud::seedance-2.0-fast-i2v',
]

describe('variantKeyForMode', () => {
  it('swaps r2v → i2v for first-frame mode (the 2026-07-02 user report)', () => {
    expect(variantKeyForMode('atlascloud::seedance-2.0-r2v', 'image', SEEDANCE_KEYS))
      .toBe('atlascloud::seedance-2.0-i2v')
  })

  it('swaps i2v → r2v for reference mode and i2v → t2v for text mode', () => {
    expect(variantKeyForMode('atlascloud::seedance-2.0-i2v', 'omni', SEEDANCE_KEYS))
      .toBe('atlascloud::seedance-2.0-r2v')
    expect(variantKeyForMode('atlascloud::seedance-2.0-i2v', 'text', SEEDANCE_KEYS))
      .toBe('atlascloud::seedance-2.0-t2v')
  })

  it('首尾帧 maps to the i2v endpoint (frame-anchored)', () => {
    expect(variantKeyForMode('atlascloud::seedance-2.0-r2v', 'firstlast', SEEDANCE_KEYS))
      .toBe('atlascloud::seedance-2.0-i2v')
  })

  it('keeps the key when already on the right variant', () => {
    expect(variantKeyForMode('atlascloud::seedance-2.0-i2v', 'image', SEEDANCE_KEYS))
      .toBe('atlascloud::seedance-2.0-i2v')
  })

  it('keeps the key when the sibling is NOT in the enabled list', () => {
    // fast line: only fast-i2v enabled — fast-r2v swap must not happen.
    expect(variantKeyForMode('atlascloud::seedance-2.0-fast-i2v', 'omni', SEEDANCE_KEYS))
      .toBe('atlascloud::seedance-2.0-fast-i2v')
  })

  it('passes through non-variant keys untouched (fal flat i2v, Kling)', () => {
    expect(variantKeyForMode('fal::kling-video-v2.5', 'image', SEEDANCE_KEYS))
      .toBe('fal::kling-video-v2.5')
    expect(isVariantSuffixedKey('fal::kling-video-v2.5')).toBe(false)
    expect(isVariantSuffixedKey('atlascloud::seedance-2.0-r2v')).toBe(true)
  })
})
