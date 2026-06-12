import { describe, expect, it } from 'vitest'
import {
  getMaxDurationPerShot,
  getMultiShotDurationWindow,
} from '@/lib/workers/handlers/multi-shot-duration-window'
import { KLING_OMNI_MAX_TOTAL_DURATION } from '@/lib/workers/handlers/kling-omni-constants'

describe('multi-shot duration window (Phase 1.5C shared module)', () => {
  it('Seedance 2.0 family providers share the 4-15s window', () => {
    for (const provider of ['taijiai', 'ark', 'atlascloud', 'fal']) {
      expect(getMultiShotDurationWindow(provider)).toEqual({ minTotalSec: 4, maxTotalSec: 15 })
    }
  })

  it('tencent-vod cap follows the Kling Omni constant (single source of truth)', () => {
    expect(getMultiShotDurationWindow('tencent-vod').maxTotalSec)
      .toBe(KLING_OMNI_MAX_TOTAL_DURATION)
  })

  it('tencent-vod floor is deliberately 0 — the b-path enforces per-shot minimums itself', () => {
    // Pinned so a future change to a non-zero floor is a conscious
    // decision, not a copy-paste of the Seedance window.
    expect(getMultiShotDurationWindow('tencent-vod').minTotalSec).toBe(0)
  })

  it('getMaxDurationPerShot returns the provider cap (REDESIGN_PLAN §1.5C signature)', () => {
    expect(getMaxDurationPerShot('fal')).toBe(15)
    expect(getMaxDurationPerShot('tencent-vod')).toBe(KLING_OMNI_MAX_TOTAL_DURATION)
  })

  it('throws explicitly on unknown providers — no provider guessing', () => {
    expect(() => getMultiShotDurationWindow('openai')).toThrow(/MULTI_SHOT_DURATION_UNKNOWN_PROVIDER/)
    expect(() => getMaxDurationPerShot('')).toThrow(/MULTI_SHOT_DURATION_UNKNOWN_PROVIDER/)
  })
})
