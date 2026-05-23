/**
 * Single-source-of-truth guard for "which video routes tolerate text-only
 * panels in multi-shot dispatch".
 *
 * Before 2026-05-22 this list was inlined in 3 places (API route,
 * V2StoryboardClient, worker dispatcher) and the ARK + fal entries got
 * added to the dispatcher but missed by the first two — user picking
 * ark::doubao-seedance-2-0-* hit PANELS_MISSING_IMAGE despite the worker
 * supporting it. Helper now centralises the rule; this test enforces
 * parity with the worker dispatcher's individual shouldUse* gates so a
 * new provider can't half-land again.
 */
import { describe, expect, it } from 'vitest'
import { VIDEO_MODEL_VARIANTS } from '@/lib/video-models/variants'
import { videoModelToleratesTextOnlyPanels } from '@/lib/video-models/multi-shot-text-only'
import { shouldUseTencentBPath } from '@/lib/workers/handlers/multi-shot-video-handler'
import { shouldUseSeedanceComposite } from '@/lib/workers/handlers/multi-shot-video-seedance-path'
import { shouldUseAtlasCloudComposite } from '@/lib/workers/handlers/multi-shot-video-atlascloud-path'
import { shouldUseArkComposite } from '@/lib/workers/handlers/multi-shot-video-ark-path'
import { shouldUseFalComposite } from '@/lib/workers/handlers/multi-shot-video-fal-path'

function dispatcherSaysTextOnlyOk(videoModel: string): boolean {
  return (
    shouldUseTencentBPath(videoModel)
    || shouldUseSeedanceComposite(videoModel)
    || shouldUseAtlasCloudComposite(videoModel)
    || shouldUseArkComposite(videoModel)
    || shouldUseFalComposite(videoModel)
  )
}

describe('videoModelToleratesTextOnlyPanels', () => {
  it('returns false for null / undefined / empty', () => {
    expect(videoModelToleratesTextOnlyPanels(null)).toBe(false)
    expect(videoModelToleratesTextOnlyPanels(undefined)).toBe(false)
    expect(videoModelToleratesTextOnlyPanels('')).toBe(false)
  })

  it('accepts Tencent VOD Kling-3 / Kling-O1 (B-path)', () => {
    expect(videoModelToleratesTextOnlyPanels('tencent-vod::Kling-3.0')).toBe(true)
    expect(videoModelToleratesTextOnlyPanels('tencent-vod::Kling-3.0-Omni')).toBe(true)
    expect(videoModelToleratesTextOnlyPanels('tencent-vod::Kling-O1')).toBe(true)
  })

  it('rejects Tencent VOD lower Kling versions (C-path i2v)', () => {
    expect(videoModelToleratesTextOnlyPanels('tencent-vod::Kling-1.6')).toBe(false)
    expect(videoModelToleratesTextOnlyPanels('tencent-vod::Kling-2.5')).toBe(false)
  })

  it('accepts BobAPI taijiai Seedance 2.0', () => {
    expect(videoModelToleratesTextOnlyPanels('taijiai::seedance-2.0-720p')).toBe(true)
  })

  it('accepts AtlasCloud Seedance 2.0 (all 6 variants)', () => {
    for (const slug of [
      'atlascloud::seedance-2.0-t2v',
      'atlascloud::seedance-2.0-i2v',
      'atlascloud::seedance-2.0-r2v',
      'atlascloud::seedance-2.0-fast-t2v',
      'atlascloud::seedance-2.0-fast-i2v',
      'atlascloud::seedance-2.0-fast-r2v',
    ]) {
      expect(videoModelToleratesTextOnlyPanels(slug)).toBe(true)
    }
  })

  it('accepts ARK direct Seedance 2.0 + 2.0 Fast', () => {
    expect(videoModelToleratesTextOnlyPanels('ark::doubao-seedance-2-0-260128')).toBe(true)
    expect(videoModelToleratesTextOnlyPanels('ark::doubao-seedance-2-0-fast-260128')).toBe(true)
  })

  it('rejects ARK 1.x Seedance (no composite worker path)', () => {
    expect(videoModelToleratesTextOnlyPanels('ark::doubao-seedance-1-5-pro-251215')).toBe(false)
    expect(videoModelToleratesTextOnlyPanels('ark::doubao-seedance-1-0-pro-250528')).toBe(false)
  })

  it('accepts fal Seedance 2.0 (i2v / r2v × std / fast)', () => {
    for (const slug of [
      'fal::bytedance/seedance-2.0/image-to-video',
      'fal::bytedance/seedance-2.0/reference-to-video',
      'fal::bytedance/seedance-2.0/fast/image-to-video',
      'fal::bytedance/seedance-2.0/fast/reference-to-video',
    ]) {
      expect(videoModelToleratesTextOnlyPanels(slug)).toBe(true)
    }
  })

  it('rejects fal Veo / Sora / Kling (C-path i2v with required first frame)', () => {
    expect(videoModelToleratesTextOnlyPanels('fal::fal-veo31')).toBe(false)
    expect(videoModelToleratesTextOnlyPanels('fal::fal-sora2')).toBe(false)
    expect(videoModelToleratesTextOnlyPanels('fal::fal-ai/kling-video/v3/pro/image-to-video')).toBe(false)
  })

  it('rejects malformed / unknown ids fail-closed', () => {
    expect(videoModelToleratesTextOnlyPanels('not-a-key')).toBe(false)
    expect(videoModelToleratesTextOnlyPanels('::')).toBe(false)
    expect(videoModelToleratesTextOnlyPanels('ark::')).toBe(false)
    expect(videoModelToleratesTextOnlyPanels('::doubao-seedance-2-0-260128')).toBe(false)
  })

  // Parity guard — every entry in VIDEO_MODEL_VARIANTS must agree with
  // the worker dispatcher's OR of individual shouldUse* gates. Adding a
  // new composite-path provider requires touching this helper too, or
  // CI will catch the drift here before it ships.
  it('agrees with dispatcher for every registered VIDEO_MODEL_VARIANTS id', () => {
    const drifts: Array<{ id: string; helper: boolean; dispatcher: boolean }> = []
    for (const variant of VIDEO_MODEL_VARIANTS) {
      const helperResult = videoModelToleratesTextOnlyPanels(variant.id)
      const dispatcherResult = dispatcherSaysTextOnlyOk(variant.id)
      if (helperResult !== dispatcherResult) {
        drifts.push({ id: variant.id, helper: helperResult, dispatcher: dispatcherResult })
      }
    }
    expect(drifts).toEqual([])
  })
})
