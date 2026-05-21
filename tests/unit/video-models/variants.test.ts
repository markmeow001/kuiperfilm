/**
 * Structural guards for the video-model variant registry.
 *
 * The registry feeds both the V2 storyboard picker and the multi-shot
 * capability gate. A drift here can silently break either: an unmapped
 * id makes the picker show "目前模型不在清單中"; a wrong capability
 * bit lets multi-shot dispatch a non-capable model (or vice versa
 * grey out a working one).
 */
import { describe, expect, it } from 'vitest'
import {
  VIDEO_MODEL_VARIANTS,
  DEFAULT_VARIANT_ID,
  getVideoModelVariant,
  getVariantsByFamily,
  isMultiShotCapable,
} from '@/lib/video-models/variants'

describe('VIDEO_MODEL_VARIANTS catalog', () => {
  it('contains both Seedance and Kling families', () => {
    const families = new Set(VIDEO_MODEL_VARIANTS.map((v) => v.family))
    expect(families.has('seedance')).toBe(true)
    expect(families.has('kling')).toBe(true)
  })

  it('every variant id is unique', () => {
    const ids = VIDEO_MODEL_VARIANTS.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every variant id uses the provider::modelId shape', () => {
    for (const v of VIDEO_MODEL_VARIANTS) {
      expect(v.id).toMatch(/^[a-z0-9-]+::.+$/i)
    }
  })

  it('every variant has a non-empty label', () => {
    for (const v of VIDEO_MODEL_VARIANTS) {
      expect(typeof v.label).toBe('string')
      expect(v.label.length).toBeGreaterThan(0)
    }
  })

  it('every variant has fully-specified capabilities (no defaults)', () => {
    for (const v of VIDEO_MODEL_VARIANTS) {
      expect(typeof v.capabilities.audio).toBe('boolean')
      expect(typeof v.capabilities.multiShot).toBe('boolean')
      expect(typeof v.capabilities.maxDurationSec).toBe('number')
      expect(v.capabilities.maxDurationSec).toBeGreaterThan(0)
      expect(['¥', '¥¥', '¥¥¥']).toContain(v.capabilities.costTier)
    }
  })

  it('fal Seedance 2.0 variants support multi-shot via fal composite path (Phase D, 2026-05-21)', () => {
    // Phase D added 2 reference-to-video variants (std + fast) and
    // upgraded the 2 existing image-to-video variants to multiShot:true,
    // backed by a new worker path (multi-shot-video-fal-path.ts) that
    // calls FalVideoGenerator with image_urls[] up to 9 + @Image1
    // prompt tags. Vendor parity with BobAPI / AtlasCloud — all 3 fully
    // support prompt-encoded multi-shot now.
    expect(isMultiShotCapable('fal::bytedance/seedance-2.0/image-to-video')).toBe(true)
    expect(isMultiShotCapable('fal::bytedance/seedance-2.0/reference-to-video')).toBe(true)
    expect(isMultiShotCapable('fal::bytedance/seedance-2.0/fast/image-to-video')).toBe(true)
    expect(isMultiShotCapable('fal::bytedance/seedance-2.0/fast/reference-to-video')).toBe(true)
  })

  it('BobAPI Seedance supports multi-shot composite (content[] @N path)', () => {
    // The variant registry MUST keep this bit true — the V2 picker
    // and the multi-shot dispatcher both read from here. Flipping
    // back to false silently breaks the 多鏡頭 button without a
    // worker change to back it up.
    expect(isMultiShotCapable('taijiai::seedance-2.0-720p')).toBe(true)
  })

  it('AtlasCloud Seedance 2.0 variants support multi-shot (model capability, prompt-encoded)', () => {
    // 2026-05-20 — Seedance 2.0 multi-shot is a MODEL capability, not an
    // endpoint capability. The model parses "第一鏡：… 第二鏡：…" shot
    // breakdowns in the prompt and produces one composite mp4 with
    // internal transitions. All 6 variants (t2v/i2v/r2v × std/fast)
    // share this capability — the endpoints only differ in what gets
    // anchored (no image / one image / 1-9 ref images).
    // Worker routes these through multi-shot-video-atlascloud-path.
    expect(isMultiShotCapable('atlascloud::seedance-2.0-t2v')).toBe(true)
    expect(isMultiShotCapable('atlascloud::seedance-2.0-i2v')).toBe(true)
    expect(isMultiShotCapable('atlascloud::seedance-2.0-r2v')).toBe(true)
    expect(isMultiShotCapable('atlascloud::seedance-2.0-fast-t2v')).toBe(true)
    expect(isMultiShotCapable('atlascloud::seedance-2.0-fast-i2v')).toBe(true)
    expect(isMultiShotCapable('atlascloud::seedance-2.0-fast-r2v')).toBe(true)
  })

  it('AtlasCloud Seedance 2.0 variants are registered and resolvable', () => {
    // Both pickers (V2 multi-shot 視頻模型 inline + profile PRESET_MODELS)
    // depend on these ids; a typo or removal silently makes the picker
    // show "目前模型不在清單中".
    expect(getVideoModelVariant('atlascloud::seedance-2.0-t2v')?.family).toBe('seedance')
    expect(getVideoModelVariant('atlascloud::seedance-2.0-i2v')?.family).toBe('seedance')
    expect(getVideoModelVariant('atlascloud::seedance-2.0-r2v')?.family).toBe('seedance')
    expect(getVideoModelVariant('atlascloud::seedance-2.0-fast-t2v')?.family).toBe('seedance')
    expect(getVideoModelVariant('atlascloud::seedance-2.0-fast-i2v')?.family).toBe('seedance')
    expect(getVideoModelVariant('atlascloud::seedance-2.0-fast-r2v')?.family).toBe('seedance')
  })

  it('every Kling variant supports multi-shot (the only family that does today)', () => {
    const kling = getVariantsByFamily('kling')
    expect(kling.length).toBeGreaterThan(0)
    for (const v of kling) {
      expect(v.capabilities.multiShot).toBe(true)
    }
  })
})

describe('DEFAULT_VARIANT_ID', () => {
  it('points at a real registry entry', () => {
    expect(getVideoModelVariant(DEFAULT_VARIANT_ID)).not.toBeNull()
  })

  it('is multi-shot capable (so freshly-onboarded projects can use 多鏡頭)', () => {
    expect(isMultiShotCapable(DEFAULT_VARIANT_ID)).toBe(true)
  })
})

describe('getVideoModelVariant', () => {
  it('returns the entry for known ids', () => {
    const v = getVideoModelVariant('tencent-vod::Kling-3.0-Omni')
    expect(v).not.toBeNull()
    expect(v!.family).toBe('kling')
  })

  it('returns null for null / empty / unknown', () => {
    expect(getVideoModelVariant(null)).toBeNull()
    expect(getVideoModelVariant(undefined)).toBeNull()
    expect(getVideoModelVariant('')).toBeNull()
    expect(getVideoModelVariant('not-a-real::model')).toBeNull()
  })
})

describe('getVariantsByFamily', () => {
  it('returns only the requested family in registry order', () => {
    const seedance = getVariantsByFamily('seedance')
    const kling = getVariantsByFamily('kling')
    expect(seedance.every((v) => v.family === 'seedance')).toBe(true)
    expect(kling.every((v) => v.family === 'kling')).toBe(true)
    expect(seedance.length + kling.length).toBe(VIDEO_MODEL_VARIANTS.length)
  })
})

describe('isMultiShotCapable (gate used by the multi-shot button)', () => {
  it('returns true for Kling Tencent VOD variants', () => {
    expect(isMultiShotCapable('tencent-vod::Kling-3.0-Omni')).toBe(true)
    expect(isMultiShotCapable('tencent-vod::Kling-1.6')).toBe(true)
  })

  it('returns true for Kling fal variants', () => {
    expect(isMultiShotCapable('fal::fal-ai/kling-video/v3/pro/image-to-video')).toBe(true)
  })

  it('returns true for fal Seedance 2.0 variants (Phase D, 2026-05-21)', () => {
    // Same prompt-encoded multi-shot capability as AtlasCloud / BobAPI.
    expect(isMultiShotCapable('fal::bytedance/seedance-2.0/image-to-video')).toBe(true)
    expect(isMultiShotCapable('fal::bytedance/seedance-2.0/reference-to-video')).toBe(true)
    expect(isMultiShotCapable('fal::bytedance/seedance-2.0/fast/image-to-video')).toBe(true)
    expect(isMultiShotCapable('fal::bytedance/seedance-2.0/fast/reference-to-video')).toBe(true)
  })

  it('returns true for BobAPI Seedance (content[] @N composite)', () => {
    expect(isMultiShotCapable('taijiai::seedance-2.0-720p')).toBe(true)
  })

  it('fails closed for null / unknown ids (never assume capability)', () => {
    // If a legacy DB row carries an id we removed, we MUST NOT light up
    // multi-shot — that would dispatch into a code path that has no
    // worker handler. Better grey button + user fixes the model.
    expect(isMultiShotCapable(null)).toBe(false)
    expect(isMultiShotCapable(undefined)).toBe(false)
    expect(isMultiShotCapable('')).toBe(false)
    expect(isMultiShotCapable('made-up::model')).toBe(false)
  })
})
