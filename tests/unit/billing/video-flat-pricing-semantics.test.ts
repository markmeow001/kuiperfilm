/**
 * Video flat-pricing semantics lock (2026-07-12).
 *
 * `flat` video entries are a 5-SECOND BASE PACKAGE price; calcVideo scales
 * them by duration/5 via applyVideoDurationScaling (baseDuration = 5 when
 * the model's capability durationOptions straddle 5). The playground
 * estimate route used to treat the same number as a PER-SECOND rate — a
 * constant 5x drift surfaced by the kling-o3 entries (two-agent review
 * 2026-07-12); it now delegates to calcVideo, so these numbers ARE the
 * user-visible estimate too.
 *
 * Amounts are locked against REAL AtlasCloud bills (console 费用明细):
 * kling-o3-std 5s with audio = $0.476 discounted / $0.56 list;
 * 14s = $1.3328 discounted (= list × 14/5 × 0.85).
 */
import { describe, expect, it } from 'vitest'
import { calcVideo } from '@/lib/billing/cost'

describe('video flat pricing = 5s base scaled by duration', () => {
  it('kling-o3-std-r2v: 5s = list $0.56, 10s = $1.12, 14s = $1.568', () => {
    expect(calcVideo('kling-o3-std-r2v', '720p', 1, { duration: 5 })).toBeCloseTo(0.56, 6)
    expect(calcVideo('kling-o3-std-r2v', '720p', 1, { duration: 10 })).toBeCloseTo(1.12, 6)
    expect(calcVideo('kling-o3-std-r2v', '720p', 1, { duration: 14 })).toBeCloseTo(1.568, 6)
  })

  it('kling-o3-pro-r2v: 5s = $0.75, 15s = $2.25', () => {
    expect(calcVideo('kling-o3-pro-r2v', '720p', 1, { duration: 5 })).toBeCloseTo(0.75, 6)
    expect(calcVideo('kling-o3-pro-r2v', '720p', 1, { duration: 15 })).toBeCloseTo(2.25, 6)
  })

  it('seedance-2.0-r2v re-authored to 5s base 0.48 (was per-second 0.096): 15s = $1.44', () => {
    // Pre-fix the money layer charged 0.096 × (15/5) = $0.288 for a 15s run
    // — 5x under the authored per-second intent. The ×5 re-authoring makes
    // BOTH layers yield the intended 0.096/sec.
    expect(calcVideo('seedance-2.0-r2v', '720p', 1, { duration: 15 })).toBeCloseTo(1.44, 6)
    expect(calcVideo('seedance-2.0-r2v', '720p', 1, { duration: 5 })).toBeCloseTo(0.48, 6)
  })
})
