import { KLING_OMNI_MAX_TOTAL_DURATION } from './kling-omni-constants'

/**
 * Phase 1.5C — per-provider multi-shot composite duration windows.
 *
 * Single source of truth replacing the four per-path copies of
 * MIN_DURATION_SEC / MAX_DURATION_SEC (seedance / ark / atlascloud /
 * fal) and parameterizing the Kling Omni 15s total cap by provider.
 *
 * Pure-data leaf module (only imports the kling-omni-constants leaf) —
 * follows the same circular-import-safe pattern; see the postmortem
 * note in kling-omni-constants.ts before adding imports here.
 *
 * Values are the same facts the paths hardcoded before this module:
 * - Seedance 2.0 family shares a 4–15s window across BobAPI(taijiai) /
 *   ARK / AtlasCloud / FAL (wiki §4.2 + Volcengine docs).
 * - Tencent VOD Kling Omni multi_shot caps the composite at 15s total
 *   (per-call durationOptions in the capability catalog are a different
 *   axis — they describe single-shot calls, not the omni composite).
 *
 * TODO(catalog): once standards/capabilities/image-video.catalog.json
 * covers taijiai and encodes multi-shot composite windows, resolve from
 * the catalog per (provider, modelId) instead of this table.
 */

export interface MultiShotDurationWindow {
  /** Floor for the composite's total seconds (0 = no floor). */
  minTotalSec: number
  /** Hard cap for the composite's total seconds. */
  maxTotalSec: number
}

const SEEDANCE_2_WINDOW: MultiShotDurationWindow = { minTotalSec: 4, maxTotalSec: 15 }

const WINDOWS_BY_PROVIDER: Record<string, MultiShotDurationWindow> = {
  // minTotalSec 0 is deliberate: Kling Omni has no documented composite
  // floor — the b-path enforces per-shot minimums itself via
  // KLING_OMNI_DEFAULT_PER_SHOT_DURATION when distributing durations.
  // This module is NOT the enforcement point for tencent-vod minimums.
  'tencent-vod': { minTotalSec: 0, maxTotalSec: KLING_OMNI_MAX_TOTAL_DURATION },
  taijiai: SEEDANCE_2_WINDOW,
  ark: SEEDANCE_2_WINDOW,
  atlascloud: SEEDANCE_2_WINDOW,
  fal: SEEDANCE_2_WINDOW,
}

/**
 * Multi-shot duration window for a provider. Throws on unknown providers
 * (explicit failure over provider guessing — CLAUDE.md §3).
 */
export function getMultiShotDurationWindow(provider: string): MultiShotDurationWindow {
  const window = WINDOWS_BY_PROVIDER[provider]
  if (!window) {
    throw new Error(
      `MULTI_SHOT_DURATION_UNKNOWN_PROVIDER: no duration window registered for provider "${provider}" — add it to multi-shot-duration-window.ts`,
    )
  }
  return window
}

/**
 * REDESIGN_PLAN §1.5C signature: the max total seconds one multi-shot
 * dispatch may carry for the given provider.
 *
 * ⚠️ Despite the spec-mandated name, this is the COMPOSITE total cap
 * (all shots in one dispatch combined), NOT a per-individual-shot cap.
 * Do not use it to clamp a single shot's duration.
 */
export function getMaxDurationPerShot(provider: string): number {
  return getMultiShotDurationWindow(provider).maxTotalSec
}
